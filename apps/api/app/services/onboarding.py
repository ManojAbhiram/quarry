"""Versioned, account-owned tour progress; legacy accounts never enroll implicitly."""
from datetime import datetime, timezone

from app.db.models import TABLES


def new_tour():
    return {'version': 1, 'state': 'eligible', 'step': 0, 'revision': 0}


def tour_for(user):
    return (user or {}).get('onboarding') or {'version': 1, 'state': 'ineligible', 'step': 0, 'revision': 0}


async def progress(user_id, state, step, revision):
    def update(doc):
        old = tour_for(doc)
        if old['state'] in ('completed', 'dismissed', 'ineligible'):
            return {}
        if old['revision'] != revision and state not in ('completed', 'dismissed'):
            return {}
        now = datetime.now(timezone.utc).isoformat()
        return {'onboarding': {**old, 'state': state, 'step': step, 'revision': old['revision'] + 1,
                               'started_at': old.get('started_at') or now, 'updated_at': now,
                               **({'finished_at': now} if state in ('completed', 'dismissed') else {})}}
    updated = await TABLES['users'].modify(user_id, update)
    return tour_for(updated)
