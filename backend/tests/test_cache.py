import time
import pytest

try:
    from backend.src.core.cache import MemoryTTLCache
except ImportError:
    from src.core.cache import MemoryTTLCache


def test_cache_set_and_get():
    """Verify standard set and get operations."""
    cache = MemoryTTLCache(maxsize=10, default_ttl=60)
    cache.set("key1", {"value": 42}, dataset_id="ds1")
    assert cache.get("key1") == {"value": 42}
    assert cache.get("nonexistent") is None


def test_cache_key_differentiation():
    """Verify different coordinates or timestamps produce unique keys."""
    k1 = MemoryTTLCache.create_key("spatial", {"lat": 21.03, "lon": 105.85, "time": "2026-11-13T01:30:00Z"})
    k2 = MemoryTTLCache.create_key("spatial", {"lat": 13.75, "lon": 100.50, "time": "2026-11-13T01:30:00Z"})
    k3 = MemoryTTLCache.create_key("spatial", {"lat": 21.03, "lon": 105.85, "time": "2026-11-13T02:30:00Z"})

    assert k1 != k2
    assert k1 != k3
    assert k2 != k3


def test_cache_invalidation_by_dataset():
    """Verify invalidating a dataset only clears entries belonging to that dataset."""
    cache = MemoryTTLCache(maxsize=10, default_ttl=60)
    cache.set("ds1_key", "data1", dataset_id="geos-cf-v2-aqc")
    cache.set("ds2_key", "data2", dataset_id="other-dataset")

    invalidated = cache.invalidate_dataset("geos-cf-v2-aqc")
    assert invalidated == 1
    assert cache.get("ds1_key") is None
    assert cache.get("ds2_key") == "data2"


def test_cache_ttl_expiration():
    """Verify expired cache entries return None."""
    cache = MemoryTTLCache(maxsize=10, default_ttl=1)  # 1 second TTL
    cache.set("short_lived", "hello", ttl=1)
    assert cache.get("short_lived") == "hello"

    time.sleep(1.1)
    assert cache.get("short_lived") is None


def test_cache_maxsize_eviction():
    """Verify cache respects maxsize limit."""
    cache = MemoryTTLCache(maxsize=2, default_ttl=60)
    cache.set("k1", "v1")
    cache.set("k2", "v2")
    cache.set("k3", "v3")  # Triggers eviction

    # Cache should never exceed maxsize 2
    active_keys = [k for k in ["k1", "k2", "k3"] if cache.get(k) is not None]
    assert len(active_keys) <= 2
