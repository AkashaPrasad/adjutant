"""Deterministic risk policy. No model is consulted when deciding what needs a human.

Rules, in order:
  1. Invalid arguments (simulation failed)                 -> blocked, high
  2. Untrusted data in a sensitive argument (taint)         -> blocked, high
  3. Read                                                   -> auto, low
  4. Irreversible write                                     -> approval required, high
  5. Reversible write carrying untrusted content            -> approval required, medium
  6. Reversible write                                       -> auto if auto_approve_low_risk, low
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .tools import Tool

Risk = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class Assessment:
    risk: Risk
    decision_required: bool
    blocked: bool
    flags: list[str] = field(default_factory=list)


def tainted_sensitive_args(tool: Tool, args: dict[str, Any], arg_sources: dict[str, str]) -> list[str]:
    return sorted(a for a in tool.sensitive_args if a in args and arg_sources.get(a) == "untrusted")


def assess(
    tool: Tool,
    args: dict[str, Any],
    arg_sources: dict[str, str],
    *,
    auto_approve_low_risk: bool,
    simulation_error: str | None = None,
) -> Assessment:
    if simulation_error is not None:
        return Assessment("high", False, True, ["invalid_args"])

    tainted = tainted_sensitive_args(tool, args, arg_sources)
    if tainted:
        return Assessment("high", False, True, [f"taint:{a}" for a in tainted])

    untrusted = [f"untrusted_content:{a}" for a in sorted(args) if arg_sources.get(a) == "untrusted"]
    if tool.kind == "read":
        return Assessment("low", False, False, ["read_only", *untrusted])
    if not tool.reversible:
        return Assessment("high", True, False, ["irreversible", *untrusted])
    if untrusted:
        return Assessment("medium", True, False, ["reversible", *untrusted])
    return Assessment("low", not auto_approve_low_risk, False, ["reversible"])
