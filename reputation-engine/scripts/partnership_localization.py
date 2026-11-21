"""Truthful service-area wording for future partnership drafts."""
import csv,re
from pathlib import Path

def normalized(value):
 return re.sub(r'[^a-z0-9]','',str(value).lower())

def service_city(city):
 path=Path(__file__).resolve().parents[1]/'partnership-system/catalogs/service-areas.csv'
 for row in csv.DictReader(path.open()):
  if normalized(row['location'])==normalized(city):return row['location']
 return None

def location_line(city,site_supported=False):
 city=service_city(city)
 if not city or not site_supported:return ''
 return f'We handle moves in {city}, and I’d like your team to have a moving contact when a job comes up.'
