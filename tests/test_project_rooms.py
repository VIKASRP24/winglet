"""Room memberships use the project transaction and never own room data."""
import pytest

from plugin.projects import ProjectConflict, ProjectError, Projects
from plugin.store import Store


@pytest.fixture
def setup(tmp_path):
    store = Store(tmp_path / 'data.db')
    device, _ = store.add_device('Owner')
    device = store.get_device(device['id'])
    projects = Projects(store)
    project = projects.create(device, None, {'name': 'Work', 'client_id': 'create-room-project'})['project']
    yield store, projects, device, project
    store.close()


def test_move_remove_replay_and_conflict(setup):
    store, projects, device, project = setup
    room = {'members': [{'profile': 'default'}, {'profile': 'other'}], 'archived': False}
    body = {'revision': project['revision'], 'client_id': 'move-room-001'}
    first = projects.move_room(device, None, 'room-1', project['id'], body, room)
    assert first == projects.move_room(device, None, 'room-1', project['id'], body, room)
    assert store._one('SELECT project_id FROM project_rooms WHERE room_id=?', ('room-1',))['project_id'] == project['id']
    with pytest.raises(ProjectConflict):
        projects.move_room(device, None, 'room-1', None,
                           {'from_project_id': project['id'], 'from_revision': 1, 'client_id': 'remove-room-stale'}, room)
    projects.move_room(device, None, 'room-1', None,
                       {'from_project_id': project['id'], 'from_revision': 2, 'client_id': 'remove-room-good'}, room)
    assert store._one('SELECT * FROM project_rooms WHERE room_id=?', ('room-1',)) is None


def test_roster_and_archived_room_are_rejected(setup):
    _, projects, device, project = setup
    for room in ({'members': [{'profile': 'other'}]},
                 {'members': [{'profile': 'default'}], 'archived': True}):
        with pytest.raises(ProjectError):
            projects.move_room(device, None, 'room-1', project['id'],
                               {'revision': 1, 'client_id': 'invalid-room-001'}, room)


def test_project_delete_releases_link(setup):
    store, projects, device, project = setup
    projects.move_room(device, None, 'room-1', project['id'],
                       {'revision': 1, 'client_id': 'move-room-delete'},
                       {'members': [{'profile': 'default'}]})
    projects.delete(device, None, project['id'], {'revision': 2, 'client_id': 'delete-room-project'})
    assert store._one('SELECT * FROM project_rooms WHERE room_id=?', ('room-1',)) is None
