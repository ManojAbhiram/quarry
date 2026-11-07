from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import OperationFailure
from app.core.config import settings
from app.core.logger import logger

client: AsyncIOMotorClient = None


async def _ensure_index(collection, keys, **kwargs):
    """
    Create an index, dropping and recreating it if the options conflict with
    an existing index of the same name (e.g. adding sparse to a non-sparse index).
    """
    try:
        await collection.create_index(keys, **kwargs)
    except OperationFailure as exc:
        if exc.code == 86:  # IndexKeySpecsConflict
            # Derive the default auto-generated name so we can drop it
            name = "_".join(f"{k}_{v}" for k, v in keys)
            logger.warning(
                "Index '%s' on '%s' has conflicting options — dropping and recreating",
                name, collection.name,
            )
            try:
                await collection.drop_index(name)
            except Exception:
                pass
            await collection.create_index(keys, **kwargs)
        else:
            raise


async def connect_db():
    global client
    try:
        logger.info(f"Connecting to MongoDB at {settings.MONGODB_URL.split('@')[-1]}")
        client = AsyncIOMotorClient(settings.MONGODB_URL)
        await client.admin.command('ping')
        logger.info("Successfully connected to MongoDB")

        db = client[settings.DATABASE_NAME]


        await _ensure_index(db.organizations, [("domain", ASCENDING)], unique=True)


        await _ensure_index(db.users, [("email", ASCENDING)], unique=True)
        await _ensure_index(db.users, [("google_id", ASCENDING)], unique=True, sparse=True)
        await _ensure_index(db.users, [("org_id", ASCENDING)])


        await _ensure_index(db.user_sessions, [("user_id", ASCENDING)])
        await _ensure_index(db.user_sessions, [("token_hash", ASCENDING)], unique=True)
        await _ensure_index(db.user_sessions, [("expires_at", ASCENDING)], expireAfterSeconds=0)


        await _ensure_index(db.requests, [("user_id", ASCENDING), ("created_at", DESCENDING)])
        await _ensure_index(db.requests, [("org_id", ASCENDING), ("created_at", DESCENDING)])
        await _ensure_index(db.requests, [("status", ASCENDING)])


        await _ensure_index(db.product_intake, [("request_id", ASCENDING)], unique=True)


        await _ensure_index(db.icp_profiles, [("request_id", ASCENDING)], unique=True)


        await _ensure_index(db.competitor_analyses, [("request_id", ASCENDING)], unique=True)
        await _ensure_index(db.competitor_analyses, [("user_id", ASCENDING)])
        await _ensure_index(db.competitor_analyses, [("status", ASCENDING)])


        # Drop stale non-sparse unique index on (user_id, source_url) — it causes
        # DuplicateKeyError for leads that have no source_url field.
        try:
            await db.leads.drop_index("user_id_1_source_url_1")
            logger.info("Dropped stale leads index 'user_id_1_source_url_1'")
        except Exception:
            pass  # already dropped or never existed
        await _ensure_index(db.leads, [("request_id", ASCENDING), ("match_score", DESCENDING)])
        await _ensure_index(db.leads, [("user_id", ASCENDING)])
        await _ensure_index(
            db.leads,
            [("request_id", ASCENDING), ("url", ASCENDING)],
            unique=True,
            sparse=True,
        )


        await _ensure_index(db.lead_enrichments, [("lead_id", ASCENDING)], unique=True)
        await _ensure_index(db.lead_enrichments, [("company_id", ASCENDING)])


        await _ensure_index(db.decision_makers, [("lead_id", ASCENDING)])


        await _ensure_index(db.companies, [("canonical_domain", ASCENDING)], unique=True)
        await _ensure_index(db.companies, [("tech_stack", ASCENDING)])  # multikey
        await _ensure_index(db.companies, [("crunchbase_id", ASCENDING)], unique=True, sparse=True)
        await _ensure_index(db.companies, [("linkedin_id", ASCENDING)], unique=True, sparse=True)


        await _ensure_index(db.competitors, [("analysis_id", ASCENDING), ("match_score", DESCENDING)])
        await _ensure_index(
            db.competitors,
            [("analysis_id", ASCENDING), ("url", ASCENDING)],
            unique=True,
            sparse=True,
        )

        # Lead lists
        await _ensure_index(db.lead_lists, [("user_id", ASCENDING)])
        await _ensure_index(db.lead_lists, [("user_id", ASCENDING), ("created_at", DESCENDING)])
        await _ensure_index(db.lead_lists, [("lead_ids", ASCENDING)])  # multikey for reverse lookup

        logger.info("All collection indexes verified/created")
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
        raise e


async def close_db():
    global client
    if client:
        client.close()
        logger.info("MongoDB connection closed")


def get_db():
    return client[settings.DATABASE_NAME]
