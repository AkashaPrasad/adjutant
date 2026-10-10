from app.canonical import args_hash, canonical_json, hmac_sign, hmac_verify
from app.policy import assess
from app.tools import default_registry

REG = default_registry()


def test_args_hash_is_canonical():
    a = args_hash("slack.post", {"channel": "#a", "text": "hi"})
    b = args_hash("slack.post", {"text": "hi", "channel": "#a"})
    assert a == b and len(a) == 64
    assert a != args_hash("slack.post", {"channel": "#a", "text": "hi!"})
    assert a != args_hash("email.send", {"channel": "#a", "text": "hi"})


def test_canonical_json_is_compact_and_sorted():
    assert canonical_json({"b": 1, "a": [1, {"d": 2, "c": 3}]}) == '{"a":[1,{"c":3,"d":2}],"b":1}'


def test_hmac_roundtrip():
    sig = hmac_sign("k", {"x": 1})
    assert hmac_verify("k", {"x": 1}, sig)
    assert not hmac_verify("k", {"x": 2}, sig)
    assert not hmac_verify("other", {"x": 1}, sig)


def test_policy_matrix():
    email, slack, http = REG.get("email.send"), REG.get("slack.post"), REG.get("http.get")
    a = assess(email, {"to": "a@b.co"}, {}, auto_approve_low_risk=True)
    assert (a.risk, a.decision_required, a.blocked) == ("high", True, False)

    a = assess(email, {"to": "a@b.co"}, {"to": "untrusted"}, auto_approve_low_risk=True)
    assert a.blocked and a.flags == ["taint:to"]

    a = assess(email, {"to": "a@b.co", "body": "x"}, {"body": "untrusted"}, auto_approve_low_risk=True)
    assert not a.blocked and "untrusted_content:body" in a.flags

    a = assess(slack, {"channel": "#a", "text": "x"}, {}, auto_approve_low_risk=True)
    assert (a.risk, a.decision_required) == ("low", False)
    assert assess(slack, {"channel": "#a", "text": "x"}, {}, auto_approve_low_risk=False).decision_required

    a = assess(slack, {"channel": "#a", "text": "x"}, {"text": "untrusted"}, auto_approve_low_risk=True)
    assert (a.risk, a.decision_required) == ("medium", True)

    a = assess(http, {"url": "https://x.example"}, {}, auto_approve_low_risk=False)
    assert (a.risk, a.decision_required, a.blocked) == ("low", False, False)

    a = assess(slack, {}, {}, auto_approve_low_risk=True, simulation_error="bad")
    assert a.blocked and a.flags == ["invalid_args"]
