import hashlib
import json
from pathlib import Path
import sys
import zipfile

receipt_path = Path(sys.argv[1]).resolve()
receipt = json.loads(receipt_path.read_text(encoding="utf-8-sig"))
stage = Path(receipt["stage"]).resolve()
archive = receipt_path.parent / ("bootstrap-" + receipt["buildId"] + ".zip")
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=5) as zipped:
    for path in sorted(stage.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("Link in staged bundle")
        if path.is_file():
            zipped.write(path, path.relative_to(stage).as_posix())
receipt.update(archive=str(archive), size=archive.stat().st_size,
               sha256=hashlib.file_digest(archive.open("rb"), "sha256").hexdigest())
receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
print(json.dumps({key: receipt[key] for key in ("buildId", "archive", "size", "sha256")}))
