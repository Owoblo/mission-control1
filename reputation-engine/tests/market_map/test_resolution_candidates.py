import csv
import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"scripts"))
from market_map.resolution_candidates import build_review,capacity,observation,key


class ResolutionCandidateTests(unittest.TestCase):
    def files(self,folder,current,historical,next_rows=None):
        files=[]
        fields=["provider_gers_id","provider_release","source_observation_id","source_record_id_basis","source_row_ordinal",
            "name","address","city","unit","postal_code","website","phones_json","observed_at","publication_date","input_files_collected","source_url"]
        for name,rows in [("current.csv.gz",current),("historical.csv.gz",historical)]+([("next.csv.gz",next_rows)] if next_rows is not None else []):
            path=folder/name
            with gzip.open(path,"wt",newline="") as stream:
                writer=csv.DictWriter(stream,fieldnames=fields)
                writer.writeheader()
                for index,row in enumerate(rows):
                    defaults={"provider_release":"2026-10-21.0","observed_at":"2026-10-26T12:00:00Z","publication_date":"2023-11-28",
                        "input_files_collected":"2019 snapshots collected2022","source_url":"https://fixture.test/evidence/"+str(index)}
                    writer.writerow({**defaults,**row})
            files.append({"file":name,"rows":len(rows),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
        (folder/"manifest.json").write_text(json.dumps({"output_files":files}))
        return folder/"current.csv.gz",folder/"historical.csv.gz",folder/"next.csv.gz" if next_rows is not None else None

    def current(self,gers,name="Fixture Company",address="12 Fixture St",city="Toronto",**values):
        return {"provider_gers_id":gers,"name":name,"address":address,"city":city,**values}

    def historical(self,identity,name="Fixture Company",address="12 Fixture St",city="Toronto",**values):
        return {"source_observation_id":identity,"source_record_id_basis":"publisher_idx","name":name,"address":address,"city":city,**values}

    def groups(self,report,lane=0):
        path=Path(report["review_lanes"][lane]["output_files"][0]["file"])
        with gzip.open(path,"rt",newline="") as stream:return list(csv.DictReader(stream))

    def test_shared_name_domain_phone_or_premises_without_all_three_keys_never_match(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            paths=self.files(folder,[self.current("g1",website="https://brand.test",phones_json='["+15195550000"]')],
                [self.historical("h1",address="14 Fixture St",website="https://brand.test",phones_json='["+15195550000"]'),
                 self.historical("h2",name="Different Fixture",website="https://brand.test"),
                 self.historical("h3",city="London")])
            report=build_review(paths[0],paths[1],folder/"review")
            self.assertEqual(report["review_lanes"][0]["candidate_clusters"],0)
            self.assertEqual(report["counts"]["source_observations_in_scratch"],4)

    def test_exact_site_keeps_branches_and_shared_premises_as_ambiguity_context(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            paths=self.files(folder,[self.current("g1"),self.current("g2",address="14 Fixture St"),self.current("g3",name="Another Fixture")],
                [self.historical("h1")])
            report=build_review(paths[0],paths[1],folder/"review")
            groups=self.groups(report)
            self.assertEqual(len(groups),1)
            self.assertEqual(groups[0]["source_observation_count"],"2")
            flags=json.loads(groups[0]["ambiguity_flags_json"])
            self.assertIn("same_published_name_multiple_observed_sites_brand_or_franchise_role_unresolved",flags)
            self.assertIn("different_published_names_share_address_across_snapshots",flags)
            self.assertEqual(groups[0]["identity_decision"],"human_review_required_no_merge")
            self.assertFalse(report["review_lanes"][0]["company_count_asserted"])

    def test_unit_and_postal_conflicts_unknowns_and_source_dates_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            paths=self.files(folder,[self.current("g1",postal_code="M5J 2J3")],
                [self.historical("h1",unit="Suite1",postal_code="M5J9Z9"),self.historical("h2",unit="Suite2")])
            report=build_review(paths[0],paths[1],folder/"review")
            flags=json.loads(self.groups(report)[0]["ambiguity_flags_json"])
            self.assertIn("published_unit_conflict",flags)
            self.assertIn("unit_not_published_or_not_parsed",flags)
            self.assertIn("published_postal_conflict",flags)
            self.assertIn("postal_unknown",flags)
            with gzip.open(report["review_lanes"][0]["output_files"][1]["file"],"rt",newline="") as stream:rows=list(csv.DictReader(stream))
            self.assertEqual({row["source_published_at"] for row in rows},{"2026-10-21","2023-11-28"})
            self.assertEqual({row["declared_unit"] for row in rows},{"","Suite1","Suite2"})
            self.assertTrue(all(row["campaign_ready"]=="False" for row in rows))

    def test_different_embedded_units_street_abbreviations_and_legal_suffixes_are_not_collapsed(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            paths=self.files(folder,[self.current("g1",name="Fixture Ltd",address="12 Fixture St Unit1")],
                [self.historical("h1",name="Fixture Ltd",address="12 Fixture St Unit2"),
                 self.historical("h2",name="Fixture Limited",address="12 Fixture St Unit1"),
                 self.historical("h3",name="Fixture Ltd",address="12 Fixture Street Unit1")])
            report=build_review(paths[0],paths[1],folder/"review")
            self.assertEqual(report["review_lanes"][0]["candidate_clusters"],0)

    def test_staged_next_release_stays_separate_and_replay_preserves_outputs_and_input_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            paths=self.files(folder,[self.current("g1")],[self.historical("h1")],[self.current("g-next",address="14 Fixture St")])
            before={path:hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
            first=build_review(paths[0],paths[1],folder/"review",next_release=paths[2])
            self.assertEqual(first["review_lanes"][0]["candidate_clusters"],1)
            self.assertEqual(first["review_lanes"][1]["candidate_clusters"],0)
            self.assertNotIn("same_published_name_multiple_observed_sites_brand_or_franchise_role_unresolved",json.loads(self.groups(first)[0]["ambiguity_flags_json"]))
            second=build_review(paths[0],paths[1],folder/"review",next_release=paths[2])
            self.assertEqual(first["counts"],second["counts"])
            self.assertEqual([lane["output_files"] for lane in first["review_lanes"]],[lane["output_files"] for lane in second["review_lanes"]])
            self.assertTrue(all(item["replayed"] for item in second["input_loading"]))
            self.assertEqual(before,{path:hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})

    def test_group_member_cap_is_explicit_and_observations_remain_in_scratch(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            paths=self.files(folder,[self.current("g1")],[self.historical("h"+str(i)) for i in range(5)])
            report=build_review(paths[0],paths[1],folder/"review",max_members=2)
            group=self.groups(report)[0]
            self.assertEqual(group["source_observation_count"],"6")
            self.assertEqual(group["emitted_observations"],"2")
            self.assertEqual(group["observations_truncated"],"True")
            self.assertEqual(report["counts"]["source_observations_in_scratch"],6)

    def test_hash_and_disk_guards_reject_mutation_before_scratch_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            paths=self.files(folder,[self.current("g1")],[self.historical("h1")])
            paths[0].write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError,"differs"):
                build_review(paths[0],paths[1],folder/"review")
            self.assertFalse((folder/"review/observations.sqlite").exists())
            with patch("market_map.resolution_candidates.shutil.disk_usage",return_value=SimpleNamespace(free=1024)):
                with self.assertRaisesRegex(RuntimeError,"paused"):
                    build_review(paths[0],paths[1],folder/"low-space")
            self.assertFalse((folder/"low-space/observations.sqlite").exists())


if __name__=="__main__":unittest.main()
