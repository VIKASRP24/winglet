"""Installation declarations and failure handling for setup prerequisites."""

import importlib.metadata
import sys
from pathlib import Path
from types import ModuleType

import pytest
import yaml
from packaging.requirements import Requirement

from plugin import dependencies


def test_declared_dependencies_cover_runtime_and_qr_and_are_installed():
    manifest = yaml.safe_load((Path(__file__).parents[1] / "plugin/plugin.yaml").read_text())
    requirements = [Requirement(spec) for spec in manifest["python_dependencies"]]
    assert {req.name for req in requirements} == set(dependencies.IMPORTS)
    for req in requirements:
        assert req.specifier.contains(importlib.metadata.version(req.name))
    assert not dependencies.missing_dependencies()


def test_qr_requirement_accepts_hermes_messaging_pin():
    # Hermes pins qrcode 7.4.2 for several messaging platforms. Winglet must
    # coexist with those in the shared environment, rather than force version 8.
    manifest = yaml.safe_load((Path(__file__).parents[1] / "plugin/plugin.yaml").read_text())
    qr = next(Requirement(spec) for spec in manifest["python_dependencies"] if spec.startswith("qrcode"))
    assert qr.specifier.contains("7.4.2")
    assert qr.specifier.contains("8.2")


@pytest.mark.parametrize("error", [ModuleNotFoundError("missing"), OSError("DLL load failed")])
def test_import_probe_catches_missing_packages_and_broken_native_dependencies(monkeypatch, error):
    def load(module):
        if module == dependencies.IMPORTS["cryptography"]:
            raise error
        return ModuleType(module)
    monkeypatch.setattr(dependencies.importlib, "import_module", load)
    assert dependencies.missing_dependencies() == ["cryptography"]


@pytest.fixture
def pm(monkeypatch):
    calls = []
    package = ModuleType("pm")
    package.sync_venv = lambda **kwargs: calls.append(kwargs)
    adoption = ModuleType("pm.environments_adopt")
    adoption.adopt_selected = lambda root: True
    paths = ModuleType("pm.paths")
    paths.repo_root = lambda: Path("hermes")
    for module in (package, adoption, paths):
        monkeypatch.setitem(sys.modules, module.__name__, module)
    return package, adoption, calls


def test_ready_setup_does_not_invoke_package_manager(monkeypatch, pm):
    monkeypatch.setattr(dependencies, "missing_dependencies", lambda: [])
    assert dependencies.ensure_ready(install=True)
    assert pm[2] == []


def test_setup_prepares_and_rechecks_dependencies_via_hermes(monkeypatch, pm):
    probes = iter([["qrcode"], []])
    monkeypatch.setattr(dependencies, "missing_dependencies", lambda: next(probes))
    assert dependencies.ensure_ready(install=True)
    assert pm[2] == [{"explicit": True}]


@pytest.mark.parametrize("failure", ["install", "restart", "still_missing"])
def test_install_failure_or_restart_never_reports_ready(monkeypatch, pm, capsys, failure):
    monkeypatch.setattr(dependencies, "missing_dependencies", lambda: ["qrcode"])
    if failure == "install":
        def fail(**kwargs):
            raise RuntimeError("resolution failed")
        pm[0].sync_venv = fail
    elif failure == "restart":
        pm[1].adopt_selected = lambda root: False
    assert not dependencies.ensure_ready(install=True)
    assert "setup" in capsys.readouterr().out


def test_pair_prerequisite_check_is_passive(monkeypatch, pm, capsys):
    monkeypatch.setattr(dependencies, "missing_dependencies", lambda: ["qrcode"])
    assert not dependencies.ensure_ready()
    assert pm[2] == []
    assert "hermes winglet setup" in capsys.readouterr().out


def test_older_pm_prepares_dependencies_then_requests_fresh_process(monkeypatch, pm, capsys):
    monkeypatch.setattr(dependencies, "missing_dependencies", lambda: ["qrcode"])
    monkeypatch.delattr(pm[1], "adopt_selected")
    assert not dependencies.ensure_ready(install=True)
    assert pm[2] == [{"explicit": True}]
    assert "Dependencies prepared" in capsys.readouterr().out
