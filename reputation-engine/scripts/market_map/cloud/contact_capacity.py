"""Explicit bounded research capacity; these are work limits, never send targets."""
import os

def capacity(env=None):
 env=os.environ if env is None else env
 fields={'domains':('REGIONAL_DOMAIN_DAILY_CAP',1000,1,10000),'workers':('REGIONAL_SOURCE_WORKERS',4,1,8),'bytes':('REGIONAL_SOURCE_BYTE_CAP',500000000,1000000,3000000000),'lookups':('REGIONAL_CARRIER_DAILY_CAP',1000,1,2500),'start_hour':('REGIONAL_RESEARCH_START_HOUR',7,0,23)}
 result={}
 for key,(name,default,low,high) in fields.items():
  value=int(env.get(name,default))
  if not low<=value<=high:raise ValueError(name+' outside supported bounds')
  result[key]=value
 return result
