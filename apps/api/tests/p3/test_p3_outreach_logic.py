from datetime import datetime

from app.outreach import logic


def test_render_uses_values_and_fallbacks():
    v = logic.build_vars({"name": "Ada Lovelace", "company": "Analytical", "email": "ada@an.test"})
    assert logic.render("Hi {{first_name|there}} from {{company}}", v) == "Hi Ada from Analytical"
    assert logic.render("Hi {{first_name|there}}", logic.build_vars({})) == "Hi there"
    assert logic.render("Hi {{ title }}!", logic.build_vars({})) == "Hi !"


def test_unknown_and_missing_variables_are_reported():
    assert logic.unknown_vars("{{first_name}} {{bogus}}") == {"bogus"}
    v = logic.build_vars({"name": "Ada"})
    assert logic.missing_values("{{first_name}} {{company}} {{title|Dr}}", v) == ["company"]


def test_next_window_slot_waits_for_weekday_and_open_hours():
    # Saturday 2026-01-03 15:00 UTC = 10:00 New York, weekend -> Monday 09:00 NY = 14:00 UTC
    slot = logic.next_window_slot(datetime(2026, 1, 3, 15), "America/New_York", "09:00", "17:00", [0, 1, 2, 3, 4])
    assert slot == datetime(2026, 1, 5, 14, 0)
    # Tuesday 10:00 NY (15:00 UTC) is inside the window: unchanged
    inside = datetime(2026, 1, 6, 15, 0)
    assert logic.next_window_slot(inside, "America/New_York", "09:00", "17:00", [0, 1, 2, 3, 4]) == inside
    # Tuesday after close (23:00 NY = 04:00 UTC Wed) -> Wednesday 09:00 NY
    late = datetime(2026, 1, 7, 4, 0)
    assert logic.next_window_slot(late, "America/New_York", "09:00", "17:00", [0, 1, 2, 3, 4]) == datetime(2026, 1, 7, 14, 0)


def test_bad_timezone_falls_back_to_utc():
    t = datetime(2026, 1, 6, 12, 0)
    assert logic.next_window_slot(t, "Not/AZone", "09:00", "17:00", [0, 1, 2, 3, 4]) == t


def test_warmup_ramps_to_cap():
    start = datetime(2026, 1, 1)
    assert logic.daily_limit(40, True, start, datetime(2026, 1, 1)) == 5
    assert logic.daily_limit(40, True, start, datetime(2026, 1, 6)) > 5
    assert logic.daily_limit(40, True, start, datetime(2026, 3, 1)) == 40
    assert logic.daily_limit(40, False, start, datetime(2026, 1, 1)) == 40


def test_signed_tokens_reject_tampering_and_wrong_purpose():
    tok = logic.sign_token("unsub", {"o": "u1", "m": "a@b.test"})
    assert logic.verify_token("unsub", tok)["o"] == "u1"
    assert logic.verify_token("open", tok) is None
    body, sig = tok.split(".")
    assert logic.verify_token("unsub", body + "." + "x" * len(sig)) is None
    assert logic.verify_token("unsub", "garbage") is None
