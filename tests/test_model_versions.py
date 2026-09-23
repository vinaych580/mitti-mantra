"""Guards that the installed scikit-learn matches the exact version the
serialized models in ml/models/ were pickled with -- unpickling a forest
across scikit-learn versions can silently change predictions."""
import re
from pathlib import Path

import sklearn

REQ = Path(__file__).resolve().parents[1] / "requirements.txt"


def test_sklearn_is_pinned_exactly():
    m = re.search(r"^scikit-learn==([\d.]+)\s*$", REQ.read_text(), re.M)
    assert m, "scikit-learn must be pinned with == in requirements.txt"
    assert sklearn.__version__ == m.group(1)


def test_pytest_not_in_production_requirements():
    assert not re.search(r"^pytest", REQ.read_text(), re.M)
