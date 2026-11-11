"""check_notebooks.py: each way a committed notebook can go stale is caught."""

import textwrap
from pathlib import Path

import nbformat
import pytest

import check_notebooks as C

BUILDER = textwrap.dedent(
    """
    from pathlib import Path
    import nbformat as nbf
    cells = [nbf.v4.new_markdown_cell("# Title"), nbf.v4.new_code_cell("x = 1"), nbf.v4.new_code_cell("print(x)")]
    nb = nbf.v4.new_notebook(cells=cells, metadata={"kernelspec": {"name": "python3", "display_name": "Python 3"}})
    nbf.write(nb, Path(__file__).with_name("demo.ipynb"))
    """
)


def executed(nb, counts=(1, 2), error_in=None):
    """Simulates nbconvert --execute: execution counts and outputs per code cell."""
    code = [c for c in nb.cells if c.cell_type == "code"]
    for cell, n in zip(code, counts):
        cell.execution_count = n
        cell.outputs = [nbformat.v4.new_output("stream", name="stdout", text="1\n")]
    if error_in is not None:
        code[error_in].outputs = [nbformat.v4.new_output("error", ename="KeyError", evalue="'x'", traceback=[])]
    return nb


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    (tmp_path / "build_demo.py").write_text(BUILDER, encoding="utf-8")
    return tmp_path


def commit(folder: Path, nb) -> None:
    nbformat.write(nb, folder / "demo.ipynb")


def built(folder: Path):
    nb, _ = C.generate(folder / "build_demo.py")
    return nb


def problems(folder: Path) -> list[str]:
    return C.check_builder(folder / "build_demo.py").problems


def test_a_rebuilt_and_executed_notebook_passes(folder):
    commit(folder, executed(built(folder)))
    assert problems(folder) == []
    assert C.main(folder) == 0


def test_generate_never_writes_the_notebook(folder):
    C.generate(folder / "build_demo.py")
    assert not (folder / "demo.ipynb").exists()


def test_editing_the_ipynb_instead_of_the_builder_is_caught(folder):
    nb = executed(built(folder))
    nb.cells[1].source = "x = 2"
    commit(folder, nb)
    assert any("out of sync" in p and "cells [1]" in p for p in problems(folder))


def test_editing_the_builder_without_rebuilding_is_caught(folder):
    commit(folder, executed(built(folder)))
    builder = folder / "build_demo.py"
    builder.write_text(builder.read_text().replace('"print(x)"', '"print(x + 1)"'), encoding="utf-8")
    assert any("out of sync" in p for p in problems(folder))


def test_rebuilt_but_not_executed_is_caught(folder):
    commit(folder, built(folder))
    assert any("never executed" in p for p in problems(folder))


def test_out_of_order_execution_is_caught(folder):
    commit(folder, executed(built(folder), counts=(3, 1)))
    assert any("execution counts" in p for p in problems(folder))


def test_a_committed_error_output_is_caught(folder):
    commit(folder, executed(built(folder), error_in=1))
    assert any("error output: KeyError" in p for p in problems(folder))


def test_a_missing_notebook_is_caught(folder):
    assert any("notebook missing" in p for p in problems(folder))


def test_a_broken_builder_is_reported_not_raised(folder):
    (folder / "build_demo.py").write_text("raise ValueError('boom')\n", encoding="utf-8")
    assert problems(folder) == ["builder failed: ValueError: boom"]


def test_a_notebook_without_a_builder_fails_the_run(folder, capsys):
    commit(folder, executed(built(folder)))
    nbformat.write(nbformat.v4.new_notebook(), folder / "stray.ipynb")
    assert C.main(folder) == 1
    assert "stray.ipynb" in capsys.readouterr().out


def test_the_real_notebooks_are_in_sync():
    assert C.main() == 0
