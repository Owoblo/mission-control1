export const campaign='kwg-subcontractor-recruiting-20261014';
export const from='+12262419853';
export const body="Hi, this is John from Saturn Star Movers.\n\nWe're expanding our network of preferred moving crews and independent movers in Kitchener, Waterloo, Cambridge, Guelph and the surrounding areas. We handle the customer bookings and are looking to build long-term relationships with reliable crews that can help fulfill residential and commercial moving jobs.\n\nWe share the job details upfront and agree on rates that work for both sides before you accept a job. You're free to take the jobs that fit your availability.\n\nIf you're interested, reply here or give me a call. I'd be happy to explain how everything works.";
export const candidates=[
[1,'Bartley Movers','Woodstock / KWG','2263761609','https://www.bartleymovers.ca/'],
[2,'Couch Commandos Movers','Kitchener / Waterloo','6475731398','https://www.kijiji.ca/v-moving-storage/city-of-toronto/fall-movers-special-negotiate-your-rate/1726089294'],
[3,'Diligent Movers','Cambridge','6476166601','https://www.diligentmovers.ca/'],
[4,'Guelph Movers','Guelph','2267804558','https://guelphmovers.com/'],
[5,'Man With Truck For Hire','Kitchener / Waterloo','5195758760','https://411.ca/business-directory/on/kitchener/entreprise-de-demenagement?c=25'],
[6,'Man With Van / Moving & Delivery','Kitchener / Waterloo','5192397606','https://www.kijiji.ca/v-moving-storage/kitchener-waterloo/man-with-van-moving-delivery/1732948002'],
[7,'Mover and Junk Removal','Guelph / Wellington / KW','2265015025','https://www.kijiji.ca/b-moving-storage/ontario/guelph/k0c144l9004'],
[8,'Moving, Delivery, Dump Runs, Furniture/Appliance Rearranging','Guelph / Fergus / Elora','','https://www.kijiji.ca/v-moving-storage/guelph/moving-delivery-dump-runs-furniture-appliance-rearranging/1720022268'],
[9,'MOVERS 5x8 TRAILER (Jay)','Brantford','9055187484','https://www.kijiji.ca/b-other-services/brantford/c87l1700206'],
[10,'Pro Express Movers','Kitchener','5195720127','https://www.kijiji.ca/b-moving-storage/kitchener-area/movers/k0c144l1700209'],
[11,'Reliable Movers','Guelph','4374600062','https://www.kijiji.ca/b-canada/movers/k0l0'],
[12,'Small Movers Canada / Marketplace Movers','Cambridge / KWG / Brantford','3658334266','https://smallmoverscanada.ca/'],
[13,'Titan Movers','Guelph','5198315438','https://www.titanmovers.ca/about-us'],
[14,'Truck and trailer for hire','Stratford','','https://www.kijiji.ca/b-ontario/truck-for-hire/page-2/k0l9004']
].map(([row,name,city,phone,source])=>({row,name,city,phone:phone?'+1'+phone:'',source,aliases:[],hold:!phone?'no_published_phone':row===11?'already_contacted_as_Creative_Movers_GTA':null}));
