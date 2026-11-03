""""Allow everything in this chat": Hermes's per-session bypass, turned on only through the
existing signed inbox answer (choice "once" plus allow_all) and off through an owner_signed route."""
import asyncio
import sys
import types

import pytest

from plugin import bridge
from plugin.hub import ROUTE_POLICY, Hub
from plugin.store import Store
from test_trust import pair_phone, post_signed

ALL_CHOICES = ['once', 'session', 'always', 'deny']


class FakeBypass:
    """Stands in for Hermes's in-memory per-session set; the mapping mirrors adapter._session_key."""

    def __init__(self):
        self.enabled = set()

    def session_key(self, chat_id):
        return 'session:' + chat_id

    def is_enabled(self, key):
        return key in self.enabled

    def enable(self, key):
        self.enabled.add(key)

    def disable(self, key):
        self.enabled.discard(key)


@pytest.fixture
async def env(tmp_path, aiohttp_client):
    store = Store(tmp_path / 'data.db')
    store.ensure_chat('general', 'General')
    store.ensure_chat('other', 'Other')
    store.ensure_chat('room', 'Room', kind='room')
    hub = Hub(store, web_root=tmp_path / 'web')
    hub.chat_approval_bypass = FakeBypass()
    hub.resolved = []

    async def approve(item, choice):
        await asyncio.sleep(0)
        hub.resolved.append((item['id'], choice))
        return True
    hub.on_approval = approve
    client = await aiohttp_client(hub.build_app())
    owner = await pair_phone(client, hub)
    member = await pair_phone(client, hub, name='Member', role='member')
    yield types.SimpleNamespace(store=store, hub=hub, client=client, owner=owner, member=member)
    for task in list(hub._push_tasks.values()):
        task.cancel()
    store.close()


def card(store, chat='general', **payload):
    return store.add_inbox('approval', chat, 'Approval needed', 'cmd', {
        'command': 'cmd', 'session_key': 'session:' + chat, 'request_id': 'r-' + chat,
        'smart_denied': False, 'choices': list(ALL_CHOICES), **payload})


def respond_path(item):
    return f"/api/inbox/{item['id']}/respond"


BYPASS = '/api/chats/{}/approval-bypass'


async def bypass_on(env, chat='general'):
    response = await env.client.get(BYPASS.format(chat), headers=env.owner.auth)
    assert response.status == 200
    return (await response.json())['enabled']


async def delete_bypass(env, chat='general', phone=None):
    phone = phone or env.owner
    path = BYPASS.format(chat)
    return await env.client.delete(path, headers=phone.signed('DELETE', path))


def audit_actions(env):
    return [row['action'] for row in env.store.list_audit()]


# -- policy and feature flag ---------------------------------------------------------------


def test_routes_have_the_required_policy():
    assert ROUTE_POLICY['h_chat_bypass_get'] == 'owner'
    assert ROUTE_POLICY['h_chat_bypass_delete'] == 'owner_signed'
    # The turn-on goes through the existing answer, which checks owner + signature itself.
    assert ROUTE_POLICY['h_inbox_respond'] == 'public'


async def test_old_server_without_the_bypass_hides_and_refuses_it(env):
    assert env.hub.features()['chat_approval_bypass'] is True
    env.hub.chat_approval_bypass = None
    assert env.hub.features()['chat_approval_bypass'] is False
    assert 'chat_yolo' not in env.hub.features()
    assert (await env.client.get(BYPASS.format('general'), headers=env.owner.auth)).status == 404
    assert (await delete_bypass(env)).status == 404
    item = card(env.store)
    response = await post_signed(env.client, env.owner, respond_path(item), {'choice': 'once', 'allow_all': True, 'chat_id': 'general'})
    assert response.status == 409
    # Refused before Hermes is told anything: the card is still waiting, nothing was approved.
    assert env.hub.resolved == [] and env.store.get_inbox(item['id'])['status'] == 'pending'


def test_bridge_offers_the_bypass_only_when_hermes_has_all_of_it(monkeypatch):
    calls = []
    full = types.SimpleNamespace(
        is_session_yolo_enabled=lambda key: calls.append(('is', key)) or False,
        enable_session_yolo=lambda key: calls.append(('on', key)),
        disable_session_yolo=lambda key: calls.append(('off', key)))
    adapter = types.SimpleNamespace(_session_key=lambda chat: 'key:' + chat)
    monkeypatch.setitem(sys.modules, 'tools', types.SimpleNamespace(approval=full))
    monkeypatch.setitem(sys.modules, 'tools.approval', full)
    bypass = bridge.chat_approval_bypass(adapter)
    assert bypass is not None
    key = bypass.session_key('general')
    bypass.enable(key), bypass.is_enabled(key), bypass.disable(key)
    assert key == 'key:general' and calls == [('on', key), ('is', key), ('off', key)]
    old = types.SimpleNamespace(enable_session_yolo=full.enable_session_yolo)
    monkeypatch.setitem(sys.modules, 'tools', types.SimpleNamespace(approval=old))
    monkeypatch.setitem(sys.modules, 'tools.approval', old)
    assert bridge.chat_approval_bypass(adapter) is None
    monkeypatch.setitem(sys.modules, 'tools', None)  # no Hermes at all: ImportError
    assert bridge.chat_approval_bypass(adapter) is None


# -- turning it on ---------------------------------------------------------------------------


async def test_owner_turns_it_on_for_that_chat_only_and_it_is_audited(env):
    item = card(env.store)
    response = await post_signed(env.client, env.owner, respond_path(item),
                                 {'choice': 'once', 'allow_all': True, 'chat_id': 'general'})
    assert response.status == 200, await response.text()
    assert env.hub.resolved == [(item['id'], 'once')]
    assert env.store.get_inbox(item['id'])['resolution'] == 'once'
    assert env.hub.chat_approval_bypass.enabled == {'session:general'}
    assert await bypass_on(env, 'general') is True
    assert await bypass_on(env, 'other') is False
    assert audit_actions(env).count('approval_bypass.on') == 1


MISSING = object()


@pytest.mark.parametrize('chat_id', [MISSING, None, 'other', 'room', '', 'General', 123, ['general']])
async def test_a_chat_id_that_is_missing_or_does_not_match_the_card_is_refused(env, chat_id):
    item = card(env.store)
    body = {'choice': 'once', 'allow_all': True}
    if chat_id is not MISSING:
        body['chat_id'] = chat_id
    response = await post_signed(env.client, env.owner, respond_path(item), body)
    assert response.status == 409
    assert not env.hub.chat_approval_bypass.enabled and env.hub.resolved == []
    assert env.store.get_inbox(item['id'])['status'] == 'pending'


@pytest.mark.parametrize('choice', ['session', 'always', 'deny'])
async def test_only_a_one_time_approval_can_carry_it(env, choice):
    item = card(env.store)
    response = await post_signed(env.client, env.owner, respond_path(item),
                                 {'choice': choice, 'allow_all': True, 'chat_id': 'general'})
    assert response.status == 409
    assert not env.hub.chat_approval_bypass.enabled and env.hub.resolved == []


@pytest.mark.parametrize('payload', [{'smart_denied': True, 'choices': ['once', 'deny']},
                                     {'smart_denied': None}, {'smart_denied': 'false'}])
async def test_smart_denied_or_unknown_cards_never_turn_it_on(env, payload):
    item = card(env.store, **payload)
    response = await post_signed(env.client, env.owner, respond_path(item), {'choice': 'once', 'allow_all': True, 'chat_id': 'general'})
    assert response.status == 409
    assert not env.hub.chat_approval_bypass.enabled and env.hub.resolved == []


async def test_a_card_whose_session_is_not_the_chats_current_one_is_refused(env):
    item = card(env.store, session_key='session:other')
    response = await post_signed(env.client, env.owner, respond_path(item), {'choice': 'once', 'allow_all': True, 'chat_id': 'general'})
    assert response.status == 409
    assert not env.hub.chat_approval_bypass.enabled and env.hub.resolved == []


@pytest.mark.parametrize('chat', ['room', 'home'])
async def test_rooms_and_updates_never_get_it(env, chat):
    item = card(env.store, chat)
    response = await post_signed(env.client, env.owner, respond_path(item),
                                 {'choice': 'once', 'allow_all': True, 'chat_id': chat})
    assert response.status == 409
    assert (await env.client.get(BYPASS.format(chat), headers=env.owner.auth)).status == 404
    assert (await delete_bypass(env, chat)).status == 404
    assert not env.hub.chat_approval_bypass.enabled and env.hub.resolved == []


async def test_an_answered_card_cannot_turn_it_on(env):
    item = card(env.store)
    assert (await post_signed(env.client, env.owner, respond_path(item), {'choice': 'deny'})).status == 200
    response = await post_signed(env.client, env.owner, respond_path(item), {'choice': 'once', 'allow_all': True, 'chat_id': 'general'})
    assert response.status == 409
    assert not env.hub.chat_approval_bypass.enabled


async def test_a_request_hermes_no_longer_has_does_not_turn_it_on(env):
    async def expired(item, choice):
        return False
    env.hub.on_approval = expired
    item = card(env.store)
    response = await post_signed(env.client, env.owner, respond_path(item), {'choice': 'once', 'allow_all': True, 'chat_id': 'general'})
    assert response.status == 409
    assert not env.hub.chat_approval_bypass.enabled
    assert 'approval_bypass.on' not in audit_actions(env)


async def test_a_non_approval_card_is_refused(env):
    question = env.store.add_inbox('question', 'general', 'Question', 'Which?', {'choices': ['a', 'b']})
    body = {'choice': 'a', 'allow_all': True, 'chat_id': 'general'}
    assert (await post_signed(env.client, env.member, respond_path(question), body)).status == 403
    assert (await post_signed(env.client, env.owner, respond_path(question), body)).status == 409
    assert env.store.get_inbox(question['id'])['status'] == 'pending'
    assert not env.hub.chat_approval_bypass.enabled


# -- who may ask --------------------------------------------------------------------------------


async def test_members_unsigned_and_unpaired_requests_are_refused(env):
    item = card(env.store)
    path, body = respond_path(item), {'choice': 'once', 'allow_all': True, 'chat_id': 'general'}
    assert (await env.client.post(path, json=body, headers=env.owner.auth)).status == 403
    assert (await post_signed(env.client, env.member, path, body)).status == 403
    assert (await env.client.post(path, json=body)).status == 403
    assert (await post_signed(env.client, env.owner, path, {**body, 'allow_all': 'yes'})).status == 400
    get_path = BYPASS.format('general')
    assert (await env.client.get(get_path, headers=env.member.auth)).status == 403
    assert (await env.client.get(get_path)).status == 401
    env.hub.chat_approval_bypass.enable('session:general')
    assert (await env.client.delete(get_path, headers=env.owner.auth)).status == 403
    assert (await delete_bypass(env, phone=env.member)).status == 403
    assert env.hub.chat_approval_bypass.enabled == {'session:general'}
    assert env.hub.resolved == [] and env.store.get_inbox(item['id'])['status'] == 'pending'


# -- turning it off -----------------------------------------------------------------------------


async def test_turning_it_off_affects_only_that_chat_and_is_audited(env):
    env.hub.chat_approval_bypass.enable('session:general')
    env.hub.chat_approval_bypass.enable('session:other')
    response = await delete_bypass(env)
    assert response.status == 200 and (await response.json()) == {'enabled': False}
    assert env.hub.chat_approval_bypass.enabled == {'session:other'}
    assert await bypass_on(env, 'general') is False
    assert (await delete_bypass(env)).status == 200  # already off: still audited, still fine
    offs = [row for row in env.store.list_audit() if row['action'] == 'approval_bypass.off']
    assert len(offs) == 2 and any('already off' in row['summary'] for row in offs)


# -- races ---------------------------------------------------------------------------------------


async def hold_first_answer(env):
    entered, release = asyncio.Event(), asyncio.Event()

    async def slow(item, choice):
        entered.set()
        await release.wait()
        env.hub.resolved.append((item['id'], choice))
        return True
    env.hub.on_approval = slow
    return entered, release


async def test_two_phones_a_plain_answer_wins_and_the_bypass_loses(env):
    item = card(env.store)
    second_owner = await pair_phone(env.client, env.hub, name='Second owner')
    entered, release = await hold_first_answer(env)
    first = asyncio.create_task(post_signed(env.client, env.owner, respond_path(item), {'choice': 'once'}))
    await asyncio.wait_for(entered.wait(), 5)
    second = asyncio.create_task(post_signed(env.client, second_owner, respond_path(item),
                                             {'choice': 'once', 'allow_all': True, 'chat_id': 'general'}))
    await asyncio.sleep(0.05)
    release.set()
    results = await asyncio.gather(first, second)
    assert [r.status for r in results] == [200, 409]
    assert env.hub.resolved == [(item['id'], 'once')]
    assert not env.hub.chat_approval_bypass.enabled
    assert 'approval_bypass.on' not in audit_actions(env)


async def test_two_phones_both_asking_for_the_bypass_turn_it_on_once(env):
    item = card(env.store)
    second_owner = await pair_phone(env.client, env.hub, name='Second owner')
    entered, release = await hold_first_answer(env)
    body = {'choice': 'once', 'allow_all': True, 'chat_id': 'general'}
    first = asyncio.create_task(post_signed(env.client, env.owner, respond_path(item), body))
    await asyncio.wait_for(entered.wait(), 5)
    second = asyncio.create_task(post_signed(env.client, second_owner, respond_path(item), body))
    await asyncio.sleep(0.05)
    release.set()
    results = await asyncio.gather(first, second)
    assert [r.status for r in results] == [200, 409]
    assert env.hub.resolved == [(item['id'], 'once')]
    assert env.hub.chat_approval_bypass.enabled == {'session:general'}
    assert audit_actions(env).count('approval_bypass.on') == 1


async def test_turning_it_off_during_an_answer_waits_and_wins(env):
    item = card(env.store)
    entered, release = await hold_first_answer(env)
    turn_on = asyncio.create_task(post_signed(env.client, env.owner, respond_path(item),
                                              {'choice': 'once', 'allow_all': True, 'chat_id': 'general'}))
    await asyncio.wait_for(entered.wait(), 5)
    turn_off = asyncio.create_task(delete_bypass(env))
    await asyncio.sleep(0.05)
    assert not turn_off.done()  # serialized behind the answer, never interleaved with it
    release.set()
    assert (await turn_on).status == 200 and (await turn_off).status == 200
    assert not env.hub.chat_approval_bypass.enabled


async def test_a_command_arriving_while_hermes_resolves_still_gets_a_normal_card(env):
    """Hermes wakes the approved worker inside resolve, before Winglet turns the bypass on. A command
    that worker runs at once must see the bypass still off (fail closed): it gets an ordinary card,
    is not approved by itself, and can be answered normally afterwards."""
    item = card(env.store)
    window = {}

    async def resolve_then_next_command(answered, choice):
        env.hub.resolved.append((answered['id'], choice))
        # What Hermes's woken worker sees for its next command:
        window['bypass_seen'] = env.hub.chat_approval_bypass.is_enabled('session:general')
        if not window['bypass_seen']:
            window['card'] = await env.hub.add_inbox(
                'approval', 'general', 'Approval needed', 'next', {
                    'command': 'next', 'session_key': 'session:general', 'request_id': 'r-next',
                    'smart_denied': False, 'choices': list(ALL_CHOICES)}, push=False)
        return True
    env.hub.on_approval = resolve_then_next_command
    response = await asyncio.wait_for(
        post_signed(env.client, env.owner, respond_path(item), {'choice': 'once', 'allow_all': True, 'chat_id': 'general'}), 5)
    assert response.status == 200
    assert window['bypass_seen'] is False
    assert env.hub.chat_approval_bypass.enabled == {'session:general'}
    nxt = env.store.get_inbox(window['card']['id'])
    assert nxt['status'] == 'pending' and nxt['payload']['choices'] == ALL_CHOICES
    assert env.hub.resolved == [(item['id'], 'once')]  # the window command was not approved for it
    response = await asyncio.wait_for(
        post_signed(env.client, env.owner, respond_path(nxt), {'choice': 'once'}), 5)
    assert response.status == 200
    assert env.hub.resolved[-1] == (nxt['id'], 'once')
