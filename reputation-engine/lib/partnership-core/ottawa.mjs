// Owner activated existing Ottawa relationships on September 16, 2026.
// Cold SMS is scoped to the specifically approved municipalities and the Dexa line.
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const locations=['Ottawa','Kanata','Nepean','Orleans','Gloucester','Stittsville','Barrhaven','Manotick','Rockland','Carp','Arnprior','Beckwith','Carleton Place','Lanark Highlands','Mississippi Mills','North Dundas','North Grenville','Russell','Richmond','McNab/Braeside','Vanier','Greely Metcalfe Osgoode Vernon And Area','Lower Town Sandy Hill','Pineview','Stittsville Munster Richmond'];
export const ottawaColdSmsLocations = ["Ottawa", "Arnprior", "Carleton Place", "Russell"];
export const ottawaSmsSender = '+15482908695';
const coldSmsLocations = new Set(ottawaColdSmsLocations.map(norm));
export const isOttawa=city=>locations.some(c=>norm(c)===norm(city));
export function ottawaActionAllowed({city,kind,channel,sender,reviewedSignal=false}){
 if(!isOttawa(city))return false;
 if(kind==='cold_introduction' && channel==='sms')
  return coldSmsLocations.has(norm(city)) && sender===ottawaSmsSender;
 if(kind==='cold_introduction' && channel==='email' && reviewedSignal===true)
  return ['Courage Eke <hello@dexamovers.ca>','Dr. Courage | Dexa Movers <hello@dexamovers.ca>'].includes(sender);
 return kind==='reply'&&((channel==='sms'&&sender===ottawaSmsSender)||(channel==='email'&&(sender==='Courage Eke <hello@dexamovers.ca>'||/^(?:Dr\.? Courage(?: \| Dexa Movers)? <)?hello@dexamovers\.ca>?$/i.test(sender))));
}
