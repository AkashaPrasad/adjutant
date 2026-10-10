"""Request models."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

NodeId = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9_.:-]{1,64}$")]
ArgSource = Literal["user", "untrusted"]
Criterion = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Sha256Hex = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9a-f]{64}$")]


class Action(BaseModel):
    node_id: NodeId
    tool: str = Field(min_length=1, max_length=64)
    args: dict[str, Any] = Field(default_factory=dict)
    arg_sources: dict[str, ArgSource] = Field(
        default_factory=dict,
        description='Provenance per argument. Unlisted arguments are treated as "user".',
    )


class PlanRequest(BaseModel):
    goal: str = Field(min_length=1, max_length=4000)
    context: str | None = Field(default=None, max_length=8000)


class RunCreate(BaseModel):
    goal: str = Field(min_length=1, max_length=4000)
    actions: list[Action] = Field(min_length=1, max_length=50)
    done_criteria: list[Criterion] = Field(default_factory=list, max_length=20)
    auto_approve_low_risk: bool = True

    @model_validator(mode="after")
    def _unique_node_ids(self) -> RunCreate:
        ids = [a.node_id for a in self.actions]
        if len(ids) != len(set(ids)):
            raise ValueError("node_id values must be unique within a run")
        return self


class DecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]
    reviewer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    approved_hashes: list[Sha256Hex] = Field(default_factory=list, max_length=50)
    note: str | None = Field(default=None, max_length=2000)


class EditRequest(BaseModel):
    node_id: NodeId
    args: dict[str, Any]
    arg_sources: dict[str, ArgSource] | None = Field(
        default=None,
        description='Optional. By default, arguments changed by the reviewer become "user"; unchanged ones keep '
        "their previous source.",
    )


class AuditVerifyRequest(BaseModel):
    packet: dict[str, Any]
    signature: str = Field(min_length=1, max_length=256)


class ResetRequest(BaseModel):
    seed: bool = False
