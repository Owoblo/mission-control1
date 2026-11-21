export const campaign='gta-subcontractor-recruiting-20261014';
export const from='+14374650584';
// Transcribed from John's supplied 65-business table, not inferred contacts.
const raw=`1|4ujworks Moving Company Inc.|Scarborough|6478006624
2|Curbside Moving Delivery|Scarborough|6476578270
3|Easy Moving Co.|Etobicoke|4162703278
4|Joe The Mover|North York|4165318094
5|Man With A Van|Toronto|6472223602
6|Medium Pickup Truck for Small Moving|North York|
7|Moving And Delivery Services|Toronto|4168813835
8|ONE DAY MOVERS|Etobicoke|4377747495
9|Paradise Movers|Etobicoke|6478389509
10|Phillips Boys Moving and Delivery Services|Toronto|6477603021
11|Small Movers - 1 Man And Big Cargo Van|East York|6475307273
12|Toronto Delivery - Edward|Toronto|4163050052
13|Movers on Demand - Brampton / Mississauga|Brampton|4164076790
14|A Man With A Van|Mississauga|6478858813
15|Arby Cartage|Brampton|4164028476
16|Gold Star Movers|Mississauga|2895417282
17|Mississauga Brampton Caledon Movers|Caledon|6479604564
18|Rapid Movers and Delivery|Mississauga|4169395570
19|Raptor Movers|Brampton|6479058259
20|Reliable Movers - Gary|Vaughan|4378554445
21|RMB Transport LTD|Brampton|6473020013
22|Man and a truck - Macx|Markham|6472808995
23|7Moving Ltd|Vaughan|4167006093
24|Arielli Moving|Newmarket|6477975767
25|Canadian Bear Moving Company|Markham|2896008111
26|Clarkson Auctions & Movers Inc.|Stouffville|9056406411
27|Den Moving Services LTD|Newmarket|4374223788
28|Ecoway Movers|Newmarket|2892360673
29|Hills Moving|Newmarket|6474603650
30|KAL Make Your Move|Richmond Hill|6477132353
31|Lake Simcoe Movers|Georgina|2895006683
32|Last Minute Movers|Vaughan|9058674283
33|Mark The Honest Mover|Markham|6474638152
34|Markham Richmond Hill Vaughan Movers|Richmond Hill|6475690434
35|MNM Services|Aurora|6475497744
36|My Ninja Services Inc.|Richmond Hill|4169929998
37|Shark Moving Service|Markham|6474049610
38|Superior Mover|Newmarket|6479554619
39|Trustworthy and Friendly Movers|King City|4379845128
40|You Call We Haul|Oshawa|4373707854|4372495731
41|ACE Moving Co.|Toronto|
42|Baker Home Solutions|Port Perry|2896882087
43|C&C Movers|Oshawa|2892740027
44|Durham Region Movers|Oshawa|4166702178|4166705734
45|G-Force Moving Company Inc.|Oshawa|6477745686
46|Helping Hands Movers|Clarington|9054105569
47|Millennium Movers|Bowmanville|9056236776
48|On The Move Moving & Junk Removal|Durham|2899872434
49|Port Perry Moving & Storage|Port Perry|9059858340
50|The Honest Movers Ltd|Whitby|9056650448
51|A2Z Movers|Hamilton|
52|Ann's Cartage & Piano Movers|Georgetown|9058776183
53|Best Way To Move Ltd|Oakville|4169996683
54|Creative Movers|Oakville|4374600062
55|Halton Hills Movers|Georgetown|2898128693
56|Halton Region Movers|Oakville|4164183035|4166705734
57|HomeBoy Movers|Oakville|4378361458
58|Ideal Moving|Milton|6476738413
59|King's Moving|Burlington|9056349595
60|Precise Moves & Deliveries|Halton Hills|6478803023
61|Rockstar Movers Inc|Burlington|6477992475
62|Big League Movers-Hamilton|Hamilton|9055150084
63|H K Movers|Hamilton|4165246704
64|Mighty Pup Moving & Delivery|Hamilton|2897698759|2897689071
65|Mountaineer Movers|Hamilton|9055618880`;
const enriched={8:'https://onedaymovers.com/',9:'https://www.paradisemovers.ca/',26:'https://clarksonmovers.com/flat_rate_pricing/',30:'https://kalmakeyourmove.com/about-us/',42:'https://www.bakerhomesolutions.ca/port-perry-movers/',50:'https://ca.nextdoor.com/pages/the-honest-mover/',58:'https://www.kijiji.ca/v-moving-storage/oakville-halton-region/ideal-moving-gta-milton-missisauga-oakville-burlington/1743418934',62:'https://www.bigleaguehamilton.ca/contact'};
enriched[10]='https://www.kijiji.ca/v-moving-storage/city-of-toronto/phillips-boys-moving-and-delivery-services/1743217434';
enriched[24]='https://ariellimoving.com/';
export const candidates=raw.split('\n').map(line=>{const[n,name,city,phone,alias]=line.split('|');const row=Number(n);return {row,name,city,phone:phone?'+1'+phone:null,aliases:alias?['+1'+alias]:[],source:enriched[row]||'Owner-supplied gta-movers-complete-list.md table, September 2026 research',source_checked:enriched[row]?'2026-10-14':null,hold:[44,56].includes(row)?'conflicting_phone_and_possible_shared_operator':!phone?'no_verified_phone':null};});
export const body="Hi, this is John from Saturn Star Movers.\n\nWe're expanding our network of preferred moving crews and independent movers in Toronto and the GTA. We handle customer bookings and are looking for reliable crews to help fulfill residential and commercial moves.\n\nWe have a job available tomorrow, October 15. If you're available, it could be a chance to see how we work together, once we've discussed the details and agreed on a rate.\n\nWe're also interested in building long-term relationships for future jobs. If you're interested, reply here or give me a call and I'll explain how it works.\n\nReply STOP if you don't want further texts.";
