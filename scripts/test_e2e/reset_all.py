#!/usr/bin/env python3
"""
Wipes ALL E2E test data across every phase, regardless of which ones have been run or how
far a previous run got. Safe to run any time, from any state: each phaseN.reset() is
declarative ("delete anything tied to this phase's known test identifiers on TEST-PROJ"),
never "undo the last run" — so a half-finished run leaves nothing this can't find and remove.

Run standalone:  python3 scripts/test_e2e/reset_all.py

When adding phase 2/3/...: import its reset() below and call it in reset_all(). Nothing else
needs to change here.
"""
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from phase1_reservation import reset as reset_phase1
from phase1b_tolerance_config import reset as reset_phase1b
from phase2_procurement import reset as reset_phase2
from phase3_stores_allocate import reset as reset_phase3
from phase4_production_wip import reset as reset_phase4
from phaseT_sas_trade import reset as reset_phaseT


def reset_all():
    print("=== Phase 1: reservation test data ===")
    reset_phase1()
    print("=== Phase 1b: matching-config test data ===")
    reset_phase1b()
    print("=== Phase 2: procurement test data ===")
    reset_phase2()
    print("=== Phase 3: Stores Allocate / Material Indent test data ===")
    reset_phase3()
    print("=== Phase 4: Production / WIP test data ===")
    reset_phase4()
    print("=== Phase T: SAS trade test data ===")
    reset_phaseT()
    print("All phases reset.")


if __name__ == "__main__":
    reset_all()
