"""Skill source metadata stays faithful to Hermes's catalog and installed lock."""

import sys
from types import SimpleNamespace

from plugin import hermes_api


async def test_catalog_source_urls_are_explicit_and_safe(monkeypatch):
    async def official():
        return {"skills": [
            {"name": "one", "identifier": "official/a/one", "repo": "https://example.org/one"},
            {"name": "two", "identifier": "official/a/two", "repo": "owner/repo"},
            {"name": "three", "identifier": "official/a/three", "source_url": "javascript:alert(1)"},
        ]}
    monkeypatch.setattr(hermes_api, "_router", lambda _: SimpleNamespace(list_official_skills=official))
    rows = await hermes_api.skill_catalog()
    assert [r["source_url"] for r in rows] == ["https://example.org/one", None, None]
    assert rows[1]["identifier"] == "official/a/two"


async def test_official_skills_link_to_their_folder_in_the_hermes_repo(monkeypatch):
    async def official():
        return {"skills": [
            {"name": "notes", "identifier": "official/productivity/notes", "source": "official",
             "repo": "NousResearch/hermes-agent"},
            {"name": "odd", "identifier": "official/../secrets", "source": "official", "repo": "NousResearch/hermes-agent"},
            {"name": "other", "identifier": "community/x/y", "source": "community", "repo": "someone/skills"},
        ]}
    monkeypatch.setattr(hermes_api, "_router", lambda _: SimpleNamespace(list_official_skills=official))
    rows = await hermes_api.skill_catalog()
    assert rows[0]["source_url"] == "https://github.com/NousResearch/hermes-agent/tree/main/optional-skills/productivity/notes"
    assert rows[1]["source_url"] is None
    assert rows[2]["source_url"] is None


async def test_installed_hub_sources_come_from_lock_not_names(monkeypatch):
    async def skills():
        return [{"name": "same", "provenance": "hub"}, {"name": "local", "provenance": "agent"},
                {"name": "unknown", "provenance": "hub"}, {"name": "notes", "provenance": "hub"}]
    class Lock:
        def list_installed(self):
            return [{"name": "same", "identifier": "github/one", "metadata": {"source_url": "https://example.org/source"}},
                    {"name": "local", "identifier": "wrong", "metadata": {"source_url": "https://example.org/wrong"}},
                    {"name": "notes", "identifier": "official/productivity/notes", "metadata": {}}]
    monkeypatch.setattr(hermes_api, "_router", lambda _: SimpleNamespace(get_skills=skills))
    monkeypatch.setitem(sys.modules, "tools.skills_hub", SimpleNamespace(HubLockFile=Lock))
    rows = await hermes_api.list_skills()
    assert rows[0]["identifier"] == "github/one"
    assert rows[0]["source_url"] == "https://example.org/source"
    assert rows[1].get("source_url") is None
    assert rows[2].get("source_url") is None
    assert rows[3]["source_url"] == "https://github.com/NousResearch/hermes-agent/tree/main/optional-skills/productivity/notes"


async def test_installed_identifier_does_not_expose_url_secrets(monkeypatch):
    identifiers = ["https://user:secret@example.com/SKILL.md", "https://example.com/SKILL.md?token=secret",
                   "https://example.com/SKILL.md#secret", "https://example.com/SKILL.md", "official/a/skill"]
    async def skills():
        return [{"name": str(i), "provenance": "hub"} for i in range(len(identifiers))]
    class Lock:
        def list_installed(self):
            return [{"name": str(i), "identifier": identifier} for i, identifier in enumerate(identifiers)]
    monkeypatch.setattr(hermes_api, "_router", lambda _: SimpleNamespace(get_skills=skills))
    monkeypatch.setitem(sys.modules, "tools.skills_hub", SimpleNamespace(HubLockFile=Lock))
    rows = await hermes_api.list_skills()
    assert [row["identifier"] for row in rows] == ["https://example.com/SKILL.md"] * 4 + [identifiers[4]]
    assert rows[2]["source_url"] is None
