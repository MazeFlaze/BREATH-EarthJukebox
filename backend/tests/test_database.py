import pytest
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

try:
    from backend.src.core.database import Base
    from backend.src.models.entities import DatasetSource, DatasetAsset, Location, ObservationSample, PRESET_LOCATIONS
    from backend.src.repositories.dataset_repository import DatasetRepository
    from backend.src.repositories.observation_repository import ObservationRepository
    from backend.src.repositories.location_repository import LocationRepository
except ImportError:
    from src.core.database import Base
    from src.models.entities import DatasetSource, DatasetAsset, Location, ObservationSample, PRESET_LOCATIONS
    from src.repositories.dataset_repository import DatasetRepository
    from src.repositories.observation_repository import ObservationRepository
    from src.repositories.location_repository import LocationRepository


@pytest.fixture
def test_db_session():
    """In-memory SQLite database session for isolated database tests."""
    test_engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=test_engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = TestingSession()

    # Seed preset locations
    for loc_data in PRESET_LOCATIONS:
        session.add(Location(**loc_data))
    session.commit()

    yield session
    session.close()


def test_preset_locations_seeded(test_db_session):
    """Verify default 10 preset locations are seeded correctly."""
    locs = LocationRepository.list_locations(test_db_session, presets_only=True)
    assert len(locs) == 10
    hanoi = LocationRepository.get_location(test_db_session, "hanoi")
    assert hanoi is not None
    assert hanoi.name == "Hanoi"
    assert hanoi.latitude == 21.03
    assert hanoi.longitude == 105.85


def test_dataset_source_upsert_idempotent(test_db_session):
    """Verify upserting DatasetSource updates rather than duplicating."""
    s1 = DatasetRepository.upsert_source(
        db=test_db_session,
        source_id="test-source",
        provider="NASA Test",
        product="test_prod",
    )
    assert s1.id == "test-source"

    # Upsert again with new provider name
    s2 = DatasetRepository.upsert_source(
        db=test_db_session,
        source_id="test-source",
        provider="NASA Updated",
        product="test_prod",
    )
    assert s2.provider == "NASA Updated"
    assert test_db_session.query(DatasetSource).count() == 1


def test_observation_unique_constraint(test_db_session):
    """Verify unique constraint prevents duplicate grid sample at identical time."""
    now = datetime.now(timezone.utc)
    source = DatasetRepository.upsert_source(test_db_session, "src-1", "NASA", "prod")
    asset = DatasetRepository.register_asset(
        test_db_session,
        asset_id="asset-1",
        dataset_source_id=source.id,
        original_filename="file.nc4",
        storage_path="/path/file.nc4",
        checksum_sha256="abc123hash",
        time_start=now,
        time_end=now,
    )

    # First insert
    ObservationRepository.upsert_sample(
        test_db_session,
        dataset_source_id=source.id,
        dataset_asset_id=asset.id,
        grid_lat=21.0,
        grid_lon=105.75,
        timestamp_utc=now,
        variable="PM25_RH35",
        value=104.0,
        unit="ug m-3",
    )
    assert test_db_session.query(ObservationSample).count() == 1

    # Second upsert for same grid cell & time updates value without error or duplication
    updated_sample = ObservationRepository.upsert_sample(
        test_db_session,
        dataset_source_id=source.id,
        dataset_asset_id=asset.id,
        grid_lat=21.0,
        grid_lon=105.75,
        timestamp_utc=now,
        variable="PM25_RH35",
        value=105.5,
        unit="ug m-3",
    )
    assert updated_sample.value == 105.5
    assert test_db_session.query(ObservationSample).count() == 1
