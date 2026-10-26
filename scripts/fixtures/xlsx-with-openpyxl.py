"""Write src/io/fixtures/openpyxl-sample.xlsx with openpyxl (#208).

The `.xlsx` reader's one fixture from a writer that is not ours: openpyxl, the
Python library, which writes shared strings, custom number formats for dates
and times, error cells and formulas with no stored result, all of which the
reader must type or report. `xlsx.test.ts` pins what it reads.

The fixture says it is openpyxl's output, so it must be written by openpyxl
(CLAUDE.md): re-run this script, never edit the file.

    python3 -m pip install --user openpyxl==3.1.5
    python3 scripts/fixtures/xlsx-with-openpyxl.py
"""

import sys
from datetime import date, datetime, time
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parents[2] / "src" / "io" / "fixtures" / "openpyxl-sample.xlsx"

if openpyxl.__version__ != "3.1.5":
    sys.exit(f"openpyxl {openpyxl.__version__} found; the fixture is pinned to 3.1.5")

wb = openpyxl.Workbook()
sites = wb.active
sites.title = "Sites"
sites.append(["id", "name", "go_live", "cost", "active"])
sites.append(["Id", "Name", "Go-live", "Cost", "Active"])
sites.append(["s-1", "Vienna, HQ", date(2027, 5, 12), 1500.25, True])
sites.append(["s-2", 'say "hi"\nnext line', "2027-Q2", None, False])
sites["A5"] = "s-3"
sites["C5"] = datetime(2027, 5, 12, 14, 30)  # a date with a time of day
sites["D5"] = "=SUM(D3:D4)"  # openpyxl does not calculate, so no result is stored
sites["E5"] = "#N/A"  # an error cell
sites["F5"] = time(12, 0)  # a time of day alone

waves = wb.create_sheet("Waves")
waves["A1"] = "wave"
waves["B3"] = 42  # an empty row 2, and a ragged row 3

wb.save(OUT)
print(f"wrote {OUT}")
