// Owner activated existing Ottawa relationships on September 16, 2026.
// New cold campaigns remain held until separately reviewed.
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const locations=['Ottawa','Kanata','Nepean','Orleans','Gloucester','Stittsville','Barrhaven','Manotick','Rockland','Carp','Arnprior','Beckwith','Carleton Place','Lanark Highlands','Mississippi Mills','North Dundas','North Grenville','Russell','Richmond','McNab/Braeside','Vanier','Greely Metcalfe Osgoode Vernon And Area','Lower Town Sandy Hill','Pineview','Stittsville Munster Richmond'];
export const isOttawa=city=>locations.some(c=>norm(c)===norm(city));
export function ottawaActionAllowed({city,kind,channel,sender}){
 if(!isOttawa(city))return false;
 return kind==='reply'&&((channel==='sms'&&sender==='+15482908695')||(channel==='email'&&/^(?:Dr\.? Courage(?: \| Dexa Movers)? <)?hello@dexamovers\.ca>?$/i.test(sender)));
}
