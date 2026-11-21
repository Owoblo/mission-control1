"""Independent local-only reconciliation of the frozen aggregate source cohort."""
from __future__ import annotations
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import struct
import zipfile
from .spatial_context import _save, _hash
from .store import stamp


def _native_zip_null_shapes(path):
    """Read matching native SHP/DBF record order; never repair or transform."""
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, 'Original publisher ZIP CRC failed'
        dbf=next(n for n in archive.namelist() if n.lower().endswith('.dbf'))
        shp=next(n for n in archive.namelist() if n.lower().endswith('.shp'))
        with archive.open(dbf) as stream:
            header=stream.read(32);count=struct.unpack('<I',header[4:8])[0]
            header_size,row_size=struct.unpack('<HH',header[8:12]);descriptors=stream.read(header_size-32)
            fields=[];offset=1
            for start in range(0,len(descriptors)-1,32):
                descriptor=descriptors[start:start+32]
                fields.append((descriptor[:11].split(b'\0')[0].decode('ascii'),offset,descriptor[16]));offset+=descriptor[16]
            ogf_field=next(field for field in fields if field[0]=='OGF_ID');ogf=[]
            for _ in range(count):
                row=stream.read(row_size);assert len(row)==row_size
                value=row[ogf_field[1]:ogf_field[1]+ogf_field[2]].strip().decode('ascii')
                ogf.append(value)
        shape_types=[];empty_polygon_ids=[];polygon_parts_points=Counter()
        with archive.open(shp) as stream:
            header=stream.read(100);assert len(header)==100
            while record_header:=stream.read(8):
                assert len(record_header)==8
                number,words=struct.unpack('>II',record_header);body=stream.read(words*2)
                assert len(body)==words*2 and len(body)>=4
                kind=struct.unpack('<I',body[:4])[0];shape_types.append(kind)
                if kind==5:
                    parts,points=struct.unpack('<II',body[36:44]);polygon_parts_points[(parts,points)]+=1
                    if points==0 or parts==0:empty_polygon_ids.append(ogf[len(shape_types)-1])
        assert len(shape_types)==count, 'Native ZIP SHP/DBF records differ'
        return {'records':count,'shape_types':dict(Counter(shape_types)),
                'null_shape_OGF_ID_strings':[key for key,kind in zip(ogf,shape_types) if kind==0],
                'empty_polygon_OGF_ID_strings':empty_polygon_ids,
                'polygon_parts_points_counts':{str(key):value for key,value in polygon_parts_points.items()}}


def audit(root):
    output=Path(root)/'aggregate-site-acquisition';manifest=json.loads((output/'manifest.json').read_text())
    receipt_bodies={};originals=0
    for receipt in manifest['raw_receipts']:
        path=output/receipt['file'];assert _hash(path)==receipt['artifact_sha256'], path
        body=path.read_bytes() if path.suffix=='.zip' else gzip.decompress(path.read_bytes())
        assert hashlib.sha256(body).hexdigest()==receipt['source_body_sha256'], path
        assert len(body)==receipt['source_bytes'], path
        if path.suffix!='.zip':receipt_bodies[receipt['file']]=json.loads(body)
        originals+=1
    layers=[]
    for layer in manifest['layers']:
        path=output/layer['records_file'];assert _hash(path)==layer['records_sha256']
        ids=set();keys=set();missing_geometry_ogf=set();null_geometry=0;count=0;names=set();alps=set()
        with gzip.open(path,'rt',encoding='utf-8') as stream:
            for line in stream:
                row=json.loads(line);count+=1
                evidence=row['raw_source_evidence'];body=receipt_bodies[evidence['file']]
                source=next(f for f in body['features'] if f['attributes']['OBJECTID']==row['source_object_id'])
                assert row['raw_source_attributes']==source['attributes']
                assert row['source_native_geometry']==source.get('geometry')
                assert row['source_record_id'] not in keys and row['source_object_id'] not in ids
                ids.add(row['source_object_id']);keys.add(row['source_record_id'])
                assert row['source_country'] is None and row['official_municipality_id'] is None
                assert row['current_business_operation_verified'] is False and row['landownership_verified'] is False
                if row['source_native_geometry'] is None:null_geometry+=1
                if 'publisher_omits_row' in row.get('source_geometry_observation_status',''):
                    missing_geometry_ogf.add(str(row['source_ogf_feature_id']))
                names.add(str(row['source_client_name_claim']));alps.add(str(row['source_alps_licence_or_permit_business_id']))
        terminal=next(body for file,body in receipt_bodies.items() if file.startswith(layer['source_id']+'/terminal-native-ID'))
        assert ids==set(terminal['objectIds']) and count==len(terminal['objectIds'])==layer['feature_records']
        zip_review=_native_zip_null_shapes(output/layer['ZIP_raw_receipt']['file'])
        null_ids=set(zip_review['null_shape_OGF_ID_strings'])
        assert count==zip_review['records'], 'Offered ZIP/live feature counts differ; needs explicit snapshot review'
        empty_ids=set(zip_review['empty_polygon_OGF_ID_strings'])
        layers.append({'source_id':layer['source_id'],'records':count,'unique_source_feature_ids':len(keys),
            'exact_source_attribute_and_returned_geometry_comparisons':count,'missing_REST_geometry_records':null_geometry,
            'REST_omitted_rows_recovered_attributes_only':len(missing_geometry_ogf),'original_ZIP_native_shape_types':zip_review['shape_types'],
            'REST_omitted_geometry_OGF_IDs_match_original_ZIP_null_shapes':missing_geometry_ogf==null_ids,
            'REST_omitted_geometry_OGF_IDs_match_original_ZIP_empty_polygons':missing_geometry_ogf==empty_ids,
            'publisher_ZIP_empty_polygon_OGF_ID_strings':sorted(empty_ids),
            'geometry_caveat':'No null/empty/degenerate native geometry is repaired, geocoded or promoted to a physical site. REST and offered ZIP remain distinct source snapshots.',
            'publisher_ZIP_null_shape_OGF_ID_strings':sorted(null_ids),'unique_reported_client_name_strings':len(names),
            'unique_ALPS_identifier_strings':len(alps),'records_sha256':layer['records_sha256'],
            'physical_building_or_company_count':None})
    invocations=[]
    for path in sorted(output.glob('full-acquisition-invocation-*-metrics.json')):
        value=json.loads(path.read_text());invocations.append({'file':path.name,**value})
    report={'status':'passed','audited_at':stamp(),'manifest_sha256':_hash(output/'manifest.json'),'layers':layers,
        'total_source_feature_records':sum(row['records'] for row in layers),'original_response_artifacts_hash_and_body_verified':originals,
        'full_acquisition_invocations':invocations,'full_acquisition_requests':sum(r['requests'] for r in invocations),
        'full_acquisition_bytes':sum(r['bytes_fetched'] for r in invocations),
        'resource_scope':'All full-acquisition and resume invocations only; metadata, previews and discrepancy review have separate meters.',
        'source_inventory_scope':'Exact three source status layers and offered ZIPs, not entire commercial market.',
        'no_main_database_access_or_external_requests':True,'market_completeness_verified':False}
    _save(output/'independent-full-cohort-audit.json',report)
    return {key:value for key,value in report.items() if key not in ['full_acquisition_invocations','layers']}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    print(json.dumps(audit(parser.parse_args().output)))
