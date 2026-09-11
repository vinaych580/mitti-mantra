# Shared base class for agmarknet.py, isro_bhuvan.py, nasa_power.py, and
# soil_grids.py. agmarknet.py is reachable from production via
# data_ingestion/fetchers/mandi.py; the other three remain unwired dead code
# -- see AUDIT_REPORT.md D-4.
import logging
import time
import requests
from typing import Any, Dict, Optional, Union

logger = logging.getLogger(__name__)

class BaseAPIClient:
    """
    Base HTTP client offering:
    1. Automatic retries with exponential backoff.
    2. Rate limit throttle control.
    3. Standardized logging and error tracking.
    """
    def __init__(
        self,
        base_url: str,
        rate_limit_delay_seconds: float = 0.0,
        max_retries: int = 3,
        backoff_factor: float = 2.0,
        timeout: float = 10.0
    ):
        self.base_url = base_url
        self.rate_limit_delay = rate_limit_delay_seconds
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self.timeout = timeout
        self.session = requests.Session()

    def request(
        self,
        method: str,
        endpoint: str = "",
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None
    ) -> Optional[requests.Response]:
        url = self.base_url
        if endpoint:
            url = f"{self.base_url.rstrip('/')}/{endpoint.lstrip('/')}"

        # Throttle rate limit if configured
        if self.rate_limit_delay > 0:
            time.sleep(self.rate_limit_delay)

        for attempt in range(1, self.max_retries + 1):
            try:
                logger.debug(f"API request: {method} {url} - Attempt {attempt}/{self.max_retries}")
                response = self.session.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json_data,
                    headers=headers,
                    timeout=self.timeout
                )

                # Special handle rate-limiting (429) status
                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    sleep_time = int(retry_after) if (retry_after and retry_after.isdigit()) else (self.backoff_factor ** attempt)
                    logger.warning(f"Rate limited (429) on {url}. Retrying after {sleep_time}s...")
                    time.sleep(sleep_time)
                    continue

                response.raise_for_status()
                return response

            except requests.exceptions.HTTPError as e:
                # For client errors (4xx other than 429), don't retry, just fail and log
                if response is not None and 400 <= response.status_code < 500:
                    logger.error(f"Client error on {url} (status={response.status_code}): {e}")
                    return response
                
                # Server errors (5xx) or retriable errors
                sleep_time = self.backoff_factor ** attempt
                logger.warning(f"Server/Retriable error on {url} (status={response.status_code if response else 'Unknown'}): {e}. Retrying in {sleep_time}s...")
                time.sleep(sleep_time)

            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                sleep_time = self.backoff_factor ** attempt
                logger.warning(f"Network error on {url}: {e}. Retrying in {sleep_time}s...")
                time.sleep(sleep_time)

            except Exception as e:
                logger.error(f"Unexpected error request {url}: {e}")
                return None

        logger.error(f"Max retries exhausted for API {url}")
        return None

    def get(self, endpoint: str = "", params: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Optional[requests.Response]:
        return self.request("GET", endpoint, params=params, headers=headers)

    def post(self, endpoint: str = "", json_data: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Optional[requests.Response]:
        return self.request("POST", endpoint, json_data=json_data, headers=headers)
