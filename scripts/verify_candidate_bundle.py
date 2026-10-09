"""Verify a Docker/OCI offline archive before loading it; no registry access.

Usage: python verify_candidate_bundle.py IMAGE.tar candidate.json
The candidate manifest must arrive through the same approved release channel.
Checksums provide integrity comparison, not a signature or proof of provenance.
"""
import hashlib
import json
import sys
import tarfile
from pathlib import Path


def verify(archive, expected):
    with archive.open("rb") as stream:
        archive_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    if archive_hash != expected["archive_sha256"]:
        raise ValueError("Archive SHA-256 mismatch")
    with tarfile.open(archive) as contents:
        members = {m.name: m for m in contents.getmembers()}
        if len(members) != len(contents.getmembers()):
            raise ValueError("Duplicate archive entries")
        verified = {}
        for name, member in members.items():
            if name.startswith("blobs/sha256/") and member.isfile():
                with contents.extractfile(member) as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                if digest != name.removeprefix("blobs/sha256/"):
                    raise ValueError("OCI blob digest mismatch: " + name)
                verified["sha256:" + digest] = member.size

        def read(descriptor):
            digest = descriptor["digest"]
            if digest not in verified or verified[digest] != descriptor["size"]:
                raise ValueError("Missing blob or descriptor size mismatch: " + digest)
            return json.load(contents.extractfile("blobs/sha256/" + digest.split(":")[1]))

        index = json.load(contents.extractfile("index.json"))
        roots = index["manifests"]
        root = next(d for d in roots if d["digest"] == expected["oci_index_digest"])
        image_index = read(root)
        platform = next(d for d in image_index["manifests"] if d.get("platform") == {"os": "linux", "architecture": "amd64"})
        if platform["digest"] != expected["platform_manifest_digest"]:
            raise ValueError("Platform manifest mismatch")
        manifest = read(platform)
        if manifest["config"]["digest"] != expected["image_config_digest"]:
            raise ValueError("Image config mismatch")
        config = read(manifest["config"])
        if config["os"] != "linux" or config["architecture"] != "amd64":
            raise ValueError("Unexpected image platform")
        labels = config["config"]["Labels"]
        for name, value in (("revision", expected["source_commit"]), ("version", expected["version"])):
            if labels["org.opencontainers.image." + name] != value:
                raise ValueError("OCI label mismatch: " + name)
        for layer in manifest["layers"]:
            if verified.get(layer["digest"]) != layer["size"]:
                raise ValueError("Missing or incorrectly sized layer")
    return {"result": "PASS", "archive_sha256": archive_hash, "verified_blobs": len(verified),
            "oci_index_digest": root["digest"], "platform_manifest_digest": platform["digest"],
            "image_config_digest": manifest["config"]["digest"], "source_commit": expected["source_commit"]}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    try:
        print(json.dumps(verify(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text(encoding="utf-8-sig"))), indent=2))
    except (ValueError, KeyError, StopIteration, tarfile.TarError) as error:
        raise SystemExit("Candidate verification failed: " + str(error))
