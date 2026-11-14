import hashlib
import json
import time
from threading import RLock
from typing import Any, Optional, Dict, Tuple
from .config import settings
from ..utils.logger import logger


class MemoryTTLCache:
    """
    Thread-safe in-memory bounded LRU/TTL cache for API responses and scientific calculations.
    Zero external service dependency (e.g. Redis not required for MVP).
    """

    def __init__(self, maxsize: int = 1000, default_ttl: int = 3600):
        self.maxsize = maxsize
        self.default_ttl = default_ttl
        self._cache: Dict[str, Tuple[Any, float, str]] = {}  # key -> (value, expire_at, dataset_id)
        self._lock = RLock()

    @staticmethod
    def create_key(prefix: str, payload: Dict[str, Any]) -> str:
        """
        Generates a deterministic SHA-256 fingerprint for a request payload.
        """
        serialized = json.dumps(payload, sort_keys=True, default=str)
        hashed = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        return f"{prefix}:{hashed}"

    def get(self, key: str) -> Optional[Any]:
        """Retrieves value from cache if unexpired, else returns None."""
        if not settings.CACHE_ENABLED:
            return None

        with self._lock:
            entry = self._cache.get(key)
            if not entry:
                return None

            value, expire_at, _ = entry
            if time.time() > expire_at:
                del self._cache[key]
                return None

            return value

    def set(self, key: str, value: Any, dataset_id: str = "default", ttl: Optional[int] = None) -> None:
        """Stores value with expiration time and dataset attribution."""
        if not settings.CACHE_ENABLED:
            return

        ttl_seconds = ttl if ttl is not None else self.default_ttl
        expire_at = time.time() + ttl_seconds

        with self._lock:
            # Enforce maxsize by evicting oldest expired or first item
            if len(self._cache) >= self.maxsize:
                now = time.time()
                expired_keys = [k for k, (_, exp, _) in self._cache.items() if now > exp]
                if expired_keys:
                    for k in expired_keys:
                        del self._cache[k]
                else:
                    # Evict first key
                    first_key = next(iter(self._cache))
                    del self._cache[first_key]

            self._cache[key] = (value, expire_at, dataset_id)

    def invalidate_dataset(self, dataset_id: str) -> int:
        """Removes all cache entries associated with a dataset after ingestion."""
        with self._lock:
            keys_to_delete = [k for k, (_, _, d_id) in self._cache.items() if d_id == dataset_id]
            for k in keys_to_delete:
                del self._cache[k]
            if keys_to_delete:
                logger.info(f"Invalidated {len(keys_to_delete)} cache entries for dataset '{dataset_id}'.")
            return len(keys_to_delete)

    def clear(self) -> None:
        """Flushes all entries."""
        with self._lock:
            self._cache.clear()


app_cache = MemoryTTLCache(
    maxsize=settings.CACHE_MAX_SIZE,
    default_ttl=settings.CACHE_TTL_SECONDS,
)
