"""Reviewed Essex-area adapters reuse the Windsor bounded collector."""
import argparse
import json
from pathlib import Path
from .windsor_physical import collect

BASE='https://gisweb.tecumseh.ca/arcgis/rest/services/OpenDataMaps/OpenDataMAP_InfraZonePropBound_Layers/MapServer'
LICENCE='https://gisweb.countyofessex.ca/OpenData/County%20of%20Essex%20-%20Open%20Government%20Licence.pdf'
TECUMSEH={
 'buildings':(34,['OBJECTID_1','BLDGID','LASTUPDATE','Area_Sqft','Num_Units','Bldg_UnitNo']),
 'addresses':(33,['OBJECTID_1','GIS_ID','AddressComplete','ADDRESS','CIVICADD','STREETNAME','CIVICNO','SUFFIX','DIRECTION','CITY','Vacant']),
 'zoning':(27,['OBJECTID','Zoning','Zoning_Sym','Former_Mun','URL']),
}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 print(json.dumps(collect(a.output,layers=TECUMSEH,base=BASE,licence=LICENCE,
     attribution='Contains information licensed under the Open Government Licence – County of Essex. Source: Town of Tecumseh. No accuracy/completeness warranty.',
     allowed_hosts=['gisweb.tecumseh.ca','gisweb.countyofessex.ca'],batch_size=100)))
