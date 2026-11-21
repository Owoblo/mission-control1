"""Evidence-first GTA regional source acquisition; no canonical store writes."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from .transport import Transport

URLS={
 'josslin-linked-liability-limits':'https://www.josslin.com/limitation-liability.htm',
 'josslin-linked-privacy':'https://www.josslin.com/privacy-policy.htm',
 'josslin-linked-insurance-terms':'https://www.josslin.com/insurance-terms.htm',
 'josslin-public-partner-grid':'https://www.josslin.com/our-partners.htm',
 'steps-linked-privacy':'https://stepspublicart.org/wpautoterms/privacy-policy/',
 'steps-official-accessible-art-project':'https://stepspublicart.org/project/accessible-art/',
 'bloor-annex-offered-public-art-spaces':'https://www.bloorannex.ca/home/public-spaces',

 'bloor-annex-offered-accessibility-partner-article':'https://www.bloorannex.ca/news-events/help-make-the-bloor-annex-more-accessible.html',
 'port-credit-offered-public-profile-sample':'https://nearme.portcredit.com/Home/View/221-salon-spa',
 'aldershot-offered-health-category':'https://aldershotbia.com/business-directory?wvcat=health-wellness',
 'aldershot-offered-salon-category':'https://aldershotbia.com/business-directory?wvcat=salon-spa',
 'aldershot-offered-services-category':'https://aldershotbia.com/business-directory?wvcat=services',
 'aldershot-offered-shop-category':'https://aldershotbia.com/business-directory?wvcat=shop',
 'aldershot-offered-community-category':'https://aldershotbia.com/business-directory?wvcat=community',

 'streetsville-native-client-bundle-00':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/c77ca13c83105a6e1aa523aa90c7246e.js',
 'streetsville-native-client-bundle-01':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/71daf552e72d4085eed8f14cbd2b04f6.js',
 'streetsville-native-client-bundle-05':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/56dc7971788d8208c903a472ede9c041.js',
 'streetsville-native-client-bundle-12':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/f6f6c20ca5577190e2e22b40fbd8ed67.js',
 'streetsville-native-client-bundle-18':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/913e6f6def6c0942e831ea8d2d9600ba.js',
 'streetsville-native-client-bundle-21':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/776b84e5b2c548727b14fd2af78ff177.js',
 'streetsville-native-client-bundle-23':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/9b5776d4476e1d0ec25793fe43b09955.js',
 'streetsville-native-client-bundle-24':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/846e527e7da66b9ab63b4a6b4f82e750.js',
 'streetsville-native-client-bundle-25':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/cf30a240f560925074d3e7d89ffe1351.js',
 'streetsville-native-client-bundle-26':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/7c1b6d403a09cf3aab86df3a3e9b5dde.js',
 'streetsville-native-client-bundle-29':'https://villageofstreetsville.com/wp-content/uploads/hummingbird-assets/deef9590aa4a19fe410f1a4b1b2c0bc8.js',
 'aldershot-offered-eat-category':'https://aldershotbia.com/business-directory?wvcat=eat',
 'richmond-hill-city-shop-local-proof':'https://www.richmondhill.ca/en/shop-local.aspx',
 'richmond-hill-current-bia-home':'https://richmondhillbia.com/',
 'richmond-hill-current-bia-directory':'https://richmondhillbia.com/business-directory/',
 'aldershot-offered-public-api-index':'https://aldershotbia.com/wp-json/',
 'streetsville-offered-public-api-index':'https://villageofstreetsville.com/wp-json/',
 'port-credit-offered-public-directory-widget':'https://nearme.portcredit.com/?Page=1&SearchTab=&FromForm=True&Name=&Keywords=&CategoriesOpen=True#resultsArea',

 'aldershot-offered-business-directory':'https://aldershotbia.com/business-directory/',
 'streetsville-offered-business-directory':'https://villageofstreetsville.com/directory/',
 'kerr-village-offered-business-directory':'https://www.kerr-village.ca/business-directory/find-a-business/',
 'port-credit-offered-business-directory':'https://www.portcredit.com/directory/',
 'richmond-hill-offered-businesses':'https://villageofrichmondhill.ca/businesses/',

 'aldershot-official-bia-home':'https://www.aldershotbia.com/',
 'streetsville-official-bia-home':'https://www.villageofstreetsville.com/',
 'kerr-village-official-bia-home':'https://www.kerr-village.ca/',
 'port-credit-official-bia-home':'https://www.portcredit.com/',
 'richmond-hill-village-official-bia-home':'https://villageofrichmondhill.ca/',

 'liberty-communitybox-api-robots':'https://cfapi.communitybox.co/robots.txt',
 'liberty-communitybox-loader-robots':'https://dashboard.communitybox.co/robots.txt',

 'college-promenade-offered-complete-list':'https://www.collegepromenadebia.ca/a-z-list-business-directory.html',
 'mount-pleasant-offered-directory':'https://mountpleasantvillage.ca/directory',
 'mount-pleasant-linked-privacy':'https://mountpleasantvillage.ca/privacy-policy/',

 'liberty-village-offered-directory':'https://www.libertyvillagebia.com/directory',
 'liberty-village-linked-privacy':'https://www.libertyvillagebia.com/privacy-policy',

 'islington-offered-business-directory':'https://www.villageofislington.com/directory/',
 'bloor-annex-offered-business-directory':'https://www.bloorannex.ca/business-directory',
 'forest-hill-offered-business-directory':'https://foresthillvillage.ca/business-directory',
 'forest-hill-linked-terms':'https://foresthillvillage.ca/terms-of-service',
 'forest-hill-linked-privacy':'https://foresthillvillage.ca/privacy-policy',
 'college-promenade-offered-directory':'https://www.collegepromenadebia.ca/directory.html',

 'forest-hill-bia-official-home':'https://www.foresthillvillage.ca/',
 'bloor-annex-bia-official-home':'https://www.bloorannex.ca/',
 'college-promenade-bia-official-home':'https://www.collegepromenadebia.ca/',
 'mount-pleasant-bia-official-home':'https://www.mountpleasantvillage.ca/',

 'wexford-offered-directory':'https://www.wexfordbia.ca/directory',
 'wexford-bia-official-home':'https://www.wexfordbia.ca/',
 'sheppard-east-village-official-home':'https://www.sharesheppard.ca/',
 'islington-village-official-home':'https://www.villageofislington.com/',
 'liberty-village-official-home':'https://www.libertyvillagebia.com/',

 'emery-public-directorist-factual-sample':'https://emeryvillagebia.ca/wp-json/directorist/v1/listings?context=view&status=publish&per_page=1&order=asc&orderby=id&_fields=id,name,permalink,address,phone,website,categories,latitude,longitude',
 'danforth-village-main-public-client':'https://dvbia.ca/assets/index-nQedY3Fu.js',
 'emery-public-api-index':'https://emeryvillagebia.ca/wp-json/',
 'emery-offered-legacy-profile-sample':'https://emeryvillagebia.ca/w2dc_listing/aa-canada-inc/',
 'danforth-village-public-directory-client':'https://dvbia.ca/assets/directory-7Og2ROFK.js',
 'emery-current-offered-directory':'https://emeryvillagebia.ca/localdirectory/',
 'danforth-village-offered-directory':'https://dvbia.ca/directory',
 'duke-heights-offered-directory':'https://dukeheights.ca/explore/',
 'emery-village-offered-directory':'https://emeryvillagebia.ca/directory-listings/',
 'danforth-mosaic-offered-retail':'https://www.danforthmosaic.com/retail',
 'danforth-village-bia-home':'https://dvbia.ca/',
 'ontario-official-bia-website-index':'https://www.ontario.ca/document/business-improvement-area-handbook/appendix-e-links-ontario-bia-websites',
 'tabia-linked-privacy':'https://www.toronto-bia.com/privacy-policy/',
 'tabia-linked-terms':'https://www.toronto-bia.com/terms-of-use/',
 'tabia-publisher-bia-index':'https://www.toronto-bia.com/find-a-bia/',
 'toronto-official-bia-list':'https://www.toronto.ca/business-economy/business-operation-growth/business-improvement-areas/bia-list/',
 'tasco-linked-terms':'https://www.tascoappliance.ca/home/terms-and-conditions/',
 'tasco-linked-privacy':'https://www.tascoappliance.ca/home/privacy-policy/',
 'ta-linked-service-terms':'https://www.taappliance.com/policies/terms-of-service',
 'ta-linked-privacy':'https://www.taappliance.com/policies/privacy-policy',
 'ta-linked-additional-terms':'https://www.taappliance.com/pages/ta-appliances-barbecues-policies-terms-and-conditions',
 'appliance-canada-linked-terms':'https://www.appliancecanada.com/pages/terms-conditions',
 'tasco-offered-store-locations':'https://www.tascoappliance.ca/home/locations/',
 'ta-appliances-contact-locations':'https://www.taappliance.com/pages/contact-us',
 'canadian-appliance-official-locator':'https://www.canadianappliance.ca/fr-CA/Showrooms',
 'appliance-canada-location-faq':'https://www.appliancecanada.com/pages/faqs',
 'brock-offered-business-profile-sample':'https://www.brockboardoftrade.com/members/wired-for-travel',
 'brock-offered-community-profile-sample':'https://www.brockboardoftrade.com/community-partners/brock-community-health-centre',
 'brock-offered-business-member-sitemap':'https://www.brockboardoftrade.com/dynamic-members_p_7c41d497_d6a9_42b0_9c1f_d017d234c57e_0_5000-sitemap.xml',
 'brock-offered-community-partner-sitemap':'https://www.brockboardoftrade.com/dynamic-community-partners_p_393741c4_6fb9_4c8e_ad65_dadf5f5199f3_0_5000-sitemap.xml',
 'brock-board-publisher-sitemap':'https://www.brockboardoftrade.com/sitemap.xml',
 'brock-board-robots-sitemap-proof':'https://www.brockboardoftrade.com/robots.txt',
 'bowmanville-bia-public-directory-client':'https://bowmanville.com/modules/bia_directory/bia_directory.js',
 'brock-board-public-directory':'https://www.brockboardoftrade.com/member-directory',
 'north-durham-chamber-home':'https://northdurhamchamber.ca/',
 'north-durham-chamber-directory':'https://northdurhamchamber.growthzoneapp.com/member-directory/Find',
 'clarington-board-directory':'https://members.cbot.ca/directory',
 'clarington-board-home':'https://www.cbot.ca/',
 'bowmanville-bia-directory':'https://bowmanville.com/directory/',
 'milton-bia-public-name-shape':'https://downtownmilton.com/wp-json/directorist/v1/listings?context=view&status=publish&per_page=1&order=asc&orderby=id&_fields=id,name,listing_title,title,permalink,listing_url,link,url',
 'milton-bia-public-listing-sample':'https://downtownmilton.com/wp-json/directorist/v1/listings?context=view&status=publish&per_page=1&order=asc&orderby=id&_fields=id,title,link,url,address,phone,website,categories,latitude,longitude',
 'burlington-bia-public-listing-sample':'https://burlingtondowntown.ca/wp-json/wp/v2/business-directory?context=view&status=publish&per_page=1&order=asc&orderby=id&_fields=id,title,link,business-category',
 'milton-bia-public-api-index':'https://downtownmilton.com/wp-json/',
 'burlington-bia-public-api-index':'https://burlingtondowntown.ca/wp-json/',
 'milton-downtown-bia-directory':'https://downtownmilton.com/directory/',
 'burlington-downtown-bia-directory':'https://burlingtondowntown.ca/business-directory-listing-alt/',
 'bronte-village-bia-business':'https://bronte-village.ca/business/',
 'whitby-offered-widget':'https://app.glueup.com/organization/7224/widget/membership-directory/corporate',
 'whitby-full-privacy':'https://www.whitbychamber.org/wp-content/uploads/WCC_Privacy-Statement.pdf',
 'ajax-publisher-open-data-licence':'https://townofajax.maps.arcgis.com/sharing/rest/content/items/22e2d8e248724d7cb0310dc2db675abd/data',
 'ajax-business-catalogue-metadata':'https://www.arcgis.com/sharing/rest/search?q=group%3Acab243a343be40bda04015c45ce70fc4%20AND%20business&num=100&f=json',
 'ajax-current-privacy':'https://ajax.ca/privacy/',
 'ajax-open-data-publisher':'https://opendata.ajax.ca/',
 'milton-offered-construction-category':'https://business.miltonchamber.ca/list/ql/construction-equipment-contractors-7',
 'brampton-current-offered-directory':'https://investbrampton.ca/business-directory/',
 'brampton-geohub-apps':'https://geohub.brampton.ca/pages/apps',
 'apbot-public-chunk-0':'https://www.apboardoftrade.com/_next/static/chunks/6874-6378adffccb8b95d.js',
 'apbot-public-chunk-1':'https://www.apboardoftrade.com/_next/static/chunks/3930-dd2f5bae17edf69e.js',
 'apbot-public-chunk-2':'https://www.apboardoftrade.com/_next/static/chunks/9971-ad57430ff6bb3af3.js',
 'apbot-public-chunk-3':'https://www.apboardoftrade.com/_next/static/chunks/1747-18e3967469297b1d.js',
 'apbot-public-chunk-4':'https://www.apboardoftrade.com/_next/static/chunks/6049-99eec52397c0787e.js',
 'apbot-public-chunk-5':'https://www.apboardoftrade.com/_next/static/chunks/5222-8414399397aa48d1.js',
 'apbot-public-chunk-6':'https://www.apboardoftrade.com/_next/static/chunks/4367-9f57d119ea394ef4.js',
 'apbot-public-chunk-7':'https://www.apboardoftrade.com/_next/static/chunks/6187-0170764a1b996a55.js',

 'ajax-public-business-layer':'https://ajaxmaps.ajax.ca/gisernie/rest/services/EcDev/Businesses_Public/FeatureServer/0?f=pjson',
 'ajax-pickering-directory-public-client':'https://www.apboardoftrade.com/_next/static/chunks/app/(frontend)/member-directory/page-75502000fd8f087a.js',
 'ajax-public-directory-service':'https://ajaxmaps.ajax.ca/gisernie/rest/services/EcDev/Businesses_Public/FeatureServer?f=pjson',
 'ajax-official-directory-entry':'https://www.ajax.ca/en/business-and-growth/business-directory.aspx',
 'milton-chamber-policy':'https://www.miltonchamber.ca/privacy-policy/',
 'milton-chamber-a':'https://business.miltonchamber.ca/list/searchalpha/a',
 'oakville-chamber-policy':'https://oakvillechamber.com/privacy-policy/',
 'whitby-chamber-policy':'https://www.whitbychamber.org/about/statements-and-protocols/',
 'ajax-public-client-script':'https://ajaxmaps.ajax.ca/bootrest/businesses/assets/index-D-0UB0yk.js',
 'ajax-pickering-board-home':'https://www.apboardoftrade.com/',
 'ajax-municipal-directory':'https://ajaxmaps.ajax.ca/bootrest/businesses/',
 'ajax-pickering-board-directory':'https://www.apboardoftrade.com/member-directory',
 'milton-chamber-directory':'https://business.miltonchamber.ca/list/',
 'oakville-chamber-directory':'https://oakvillechamber.com/directory/',
 'whitby-chamber-directory':'https://www.whitbychamber.org/be-a-member/shoplocalmembershipdirectory/',
 'bild-robots-policy':'https://www.bildgta.ca/robots.txt',
 'bild-policy':'https://www.bildgta.ca/privacy-policy/',
 'bild-public-client-script':'https://www.bildgta.ca/wp-content/themes/bildgta-theme/js/bildgta.min.js?ver=1.0.1',
 'mcahn-home':'https://www.mcahamiltonniagara.org/',
 'tca-terms':'https://www.tcaconnect.com/terms-conditions.html',
 'tca-privacy':'https://www.tcaconnect.com/privacy-policy.html',
 'bild-member-directory':'https://www.bildgta.ca/about/find-a-member/',
 'mcat-directory':'https://members.mcatoronto.org/contractors/Find',
 'mcat-home':'https://www.mcatoronto.org/',
 'mcahn-directory':'https://www.mcahamiltonniagara.org/directory.php',
 'tca-member-directory':'https://www.tcaconnect.com/Membership/Directory.html',
 'bild-home':'https://www.bildgta.ca/',
 'chhma-home':'https://chhma.ca/',
 'bloor-west-policy':'https://www.bloorwestvillagebia.com/privacy-policy/',
 'liberty-village-policy':'https://www.libertyvillagebia.com/privacy-policy',
 'hamilton-chamber-terms':'https://www.hamiltonchamber.ca/terms-and-conditions/',
 'hamilton-chamber-privacy':'https://www.hamiltonchamber.ca/privacy-policy/',
 'hamilton-chamber-public-api':'https://www.hamiltonchamber.ca/wp-json/',
 'vaughan-chamber-privacy':'https://www.vaughanchamber.ca/privacy-policy/',
 'brampton-board-privacy':'https://bramptonbot.com/privacy-policy/',
 'brampton-board-public-directory':'https://members.bramptonbot.com/member-directory',
 'hamilton-chamber-home':'https://www.hamiltonchamber.ca/',
 'hamilton-chamber-directory':'https://www.hamiltonchamber.ca/directory/',
 'markham-board-directory':'https://member.markhamboard.com/directory',
 'vaughan-chamber-directory':'https://web.vaughanchamber.ca/external/wcpages3/wcdirectory/Directory.aspx?action=catlist',
 'brampton-board-offered-legacy-directory':'https://business.bramptonbot.com/list/',
 'york-aurora-all-offered':'https://ww4.yorkmaps.ca/locateit/BusinessDirectory/aurora/all.html',
 'york-aurora-directory-index':'https://ww4.yorkmaps.ca/locateit/BusinessDirectory/aurora/index.html',
 'york-publisher-directory-map':'https://ww4.yorkmaps.ca/locateit/BusinessDirectory/index.html',
 'brampton-board-home':'https://bramptonbot.com/',
 'caledon-policy':'https://www.caledon.ca/en/privacy-policy.aspx',
 'downtown-yonge-factual-schema':'https://downtownyonge.com/wp-json/geodir/v2/places/fields?per_page=100',
 'downtown-yonge-factual-sample':'https://downtownyonge.com/wp-json/geodir/v2/places?per_page=1&_fields=id,link,title,street,city,region,country,zip,phone,website,post_category,latitude,longitude',
 'downtown-yonge-public-api-index':'https://downtownyonge.com/wp-json/',
 'downtown-yonge-public-search':'https://downtownyonge.com/search/?geodir_search=1&stype=gd_place&s=&snear=&sgeo_lat=&sgeo_lon=',
 'hamilton-food-licences-service':'https://services.arcgis.com/rYz782eMbySr2srL/arcgis/rest/services/Licensed_Food_Establishments/FeatureServer?f=pjson',
 'hamilton-acceptable-use':'https://www.hamilton.ca/acceptable-use-agreement',
 'halton-hills-current-policy':'https://www.haltonhills.ca/privacy-policy',
 'bloor-west-public-profile-sample':'https://www.bloorwestvillagebia.com/directory/850-degrees/',
 'bloor-west-public-api-index':'https://www.bloorwestvillagebia.com/wp-json/',
 'hamilton-food-licences-item':'https://www.arcgis.com/sharing/rest/content/items/e724b780b8fd4aa891d9c1ea99c488ed?f=pjson',
 'hamilton-data-licence':'https://www.hamilton.ca/city-council/data-maps/open-data/open-data-licence-terms-and-conditions',
 'hamilton-data-policy-page':'https://www.hamilton.ca/city-council/data-maps/open-data',
 'halton-hills-privacy':'https://www.haltonhills.ca/en/privacy-policy.aspx',
 'halton-hills-directory-count':'https://map.haltonhills.ca/awse/rest/services/eP/MapServer/3/query?f=json&where=1%3D1&returnCountOnly=true',
 'halton-hills-directory-municipalities':'https://map.haltonhills.ca/awse/rest/services/eP/MapServer/3/query?f=json&where=1%3D1&outFields=Busi_Municipality&returnDistinctValues=true&returnGeometry=false',
 'halton-hills-directory-layer':'https://map.haltonhills.ca/awse/rest/services/eP/MapServer/3?f=pjson',
 'halton-hills-directory-item':'https://www.arcgis.com/sharing/rest/content/items/c289da9e158e4f7bba33bc1dfeefc172?f=pjson',
 'downtown-yonge-page2':'https://downtownyonge.com/business-directory/page/2/',
 'downtown-yonge-directory':'https://downtownyonge.com/business-directory/',
 'bloor-west-directory':'https://www.bloorwestvillagebia.com/directory/',
 'liberty-village-directory':'https://www.libertyvillagebia.com/directory/',
 'caledon-directory':'https://www.caledonbusiness.ca/data-centre/business-directory',
 'caledon-chamber':'https://caledonchamberofcommerce.ca/members/',
 'burlington-directory':'https://investburlington.ca/burlington-business-directory/',
 'milton-data':'https://data.milton.ca/',
 'halton-hills-data':'https://www.investhaltonhills.com/en/why-halton-hills/invest-halton-hills-data-centre.aspx',
 'mississauga-privacy':'https://www.investmississauga.ca/privacy-policy/',
 'brampton-hub-ogc-record':'https://hub.arcgis.com/api/search/v1/collections/all/items/04a4ba1bbdd54faa8ea49bc0ef1033ce_0',
 'mississauga-hub-ogc-record':'https://hub.arcgis.com/api/search/v1/collections/all/items/073787e3977e4e2e9c68ff13093b6d9e_0',
 'brampton-item-open-licence':'https://www.arcgis.com/sharing/rest/content/items/04a4ba1bbdd54faa8ea49bc0ef1033ce?f=pjson',
 'mississauga-terms-pdf':'https://www5.mississauga.ca/research_catalogue/CityofMississauga_TermsofUse.pdf',
 'mississauga-business-services':'https://www.investmississauga.ca/resources/business-services/',
 'york-directory-item-search':'https://www.arcgis.com/sharing/rest/search?q=owner%3AYorkMunicipalGovt%20AND%20Business%20Directory&num=100&f=json',
 'mississauga-licence-page':'https://data.mississauga.ca/pages/open-data-licence',
 'mississauga-directory-layer':'https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/2025_Mississauga_Business_Directory/FeatureServer/0?f=pjson',
 'york-licence-pdf':'https://www.arcgis.com/sharing/rest/content/items/78cc02388af248c0b7a30eda6adfade0/data',
 'mississauga-directory-item':'https://www.arcgis.com/sharing/rest/content/items/073787e3977e4e2e9c68ff13093b6d9e?f=pjson',
 'mississauga-directory-page':'https://data.mississauga.ca/datasets/073787e3977e4e2e9c68ff13093b6d9e_0/explore',
 'york-licence-item':'https://www.arcgis.com/sharing/rest/content/items/78cc02388af248c0b7a30eda6adfade0?f=pjson',
 'york-layer':'https://services1.arcgis.com/GzvOwaQBbX7KLiuG/ArcGIS/rest/services/Business_Directory_2024/FeatureServer/1?f=pjson',
 'york-item':'https://www.arcgis.com/sharing/rest/content/items/af0ce4be5afc4864b0c3c1f601ec8fe8?f=pjson',
 'york-open-data':'https://www.york.ca/york-region/statistics-and-data/open-data',
 'york-licence':'https://insights-york.opendata.arcgis.com/documents/york-region-open-data-licence/explore',
 'mississauga-directories':'https://www.investmississauga.ca/resources/directories/',
 'mississauga-open-data':'https://data.mississauga.ca/',
 'hamilton-open-data':'https://open.hamilton.ca/',
 'hamilton-survey':'https://www.hamilton.ca/city-council/data-maps/annual-employment-inventory-survey',
}
HOSTS=['www.josslin.com','josslin.com','stepspublicart.org','www.stepspublicart.org','www.richmondhill.ca','richmondhillbia.com','www.richmondhillbia.com','nearme.portcredit.com','www.aldershotbia.com','aldershotbia.com','www.villageofstreetsville.com','villageofstreetsville.com','www.kerr-village.ca','kerr-village.ca','www.portcredit.com','portcredit.com','villageofrichmondhill.ca','www.villageofrichmondhill.ca','cfapi.communitybox.co','dashboard.communitybox.co','mountpleasantvillage.ca','www.foresthillvillage.ca','foresthillvillage.ca','www.bloorannex.ca','bloorannex.ca','www.collegepromenadebia.ca','collegepromenadebia.ca','www.mountpleasantvillage.ca','mountpleasantvillage.ca','www.wexfordbia.ca','wexfordbia.ca','www.sharesheppard.ca','sharesheppard.ca','www.villageofislington.com','villageofislington.com','dukeheights.ca','emeryvillagebia.ca','www.danforthmosaic.com','dvbia.ca','www.ontario.ca','www.toronto-bia.com','www.toronto.ca','www.tascoappliance.ca','www.taappliance.com','www.canadianappliance.ca','www.appliancecanada.com','www.brockboardoftrade.com','northdurhamchamber.ca','northdurhamchamber.growthzoneapp.com','members.cbot.ca','www.cbot.ca','bowmanville.com','downtownmilton.com','burlingtondowntown.ca','bronte-village.ca','app.glueup.com','townofajax.maps.arcgis.com','opendata.ajax.ca','investbrampton.ca','geohub.brampton.ca','ajax.ca','www.ajax.ca','www.miltonchamber.ca','ajaxmaps.ajax.ca','www.apboardoftrade.com','business.miltonchamber.ca','oakvillechamber.com','www.whitbychamber.org','members.mcatoronto.org','www.mcatoronto.org','www.mcahamiltonniagara.org','www.tcaconnect.com','www.bildgta.ca','chhma.ca','hub.arcgis.com','ww4.yorkmaps.ca','business.bramptonbot.com','members.bramptonbot.com','www.vaughanchamber.ca','vaughanchamber.ca','www.hamiltonchamber.ca','member.markhamboard.com','web.vaughanchamber.ca','bramptonbot.com','services.arcgis.com','www.haltonhills.ca','map.haltonhills.ca','www.caledon.ca','downtownyonge.com','www.downtownyonge.com','www.bloorwestvillagebia.com','www.libertyvillagebia.com','www.caledonbusiness.ca','caledonchamberofcommerce.ca','investburlington.ca','data.milton.ca','www.investhaltonhills.com','www5.mississauga.ca','services6.arcgis.com','services1.arcgis.com','www.arcgis.com','www.york.ca','insights-york.opendata.arcgis.com','www.investmississauga.ca','data.mississauga.ca','open.hamilton.ca','www.hamilton.ca']

def save(path,data):
 temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');temp.replace(path)

def inspect(folder, only=None):
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(folder).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 t=Transport(max_requests=100,max_bytes=25000000,max_response_bytes=5000000,timeout=30,retries=1,allowed_hosts=HOSTS)
 previous=json.loads((folder/'inspection.json').read_text()) if (folder/'inspection.json').exists() else {}
 receipts=[]
 def persist():
  prior_rows={r['id']:r for r in previous.get('receipts',[])};prior_rows.update({r['id']:r for r in receipts})
  fresh=t.metrics();old=previous.get('metrics',{})
  metrics={**fresh,'requests':int(old.get('requests',0))+fresh['requests'],'bytes_fetched':int(old.get('bytes_fetched',0))+fresh['bytes_fetched'],'elapsed_seconds':round(float(old.get('elapsed_seconds',0))+fresh['elapsed_seconds'],3),'robots_checked':{**old.get('robots_checked',{}),**fresh['robots_checked']},'fresh_invocation':fresh}
  save(folder/'inspection.json',{'receipts':list(prior_rows.values()),'metrics':metrics,'business_rows_acquired':0,'rights_review_pending':True})
 for name,url in URLS.items():
  if only and name not in only:continue
  path=folder/(name+'.response')
  if path.exists():
   old=next((r for r in previous.get('receipts',[]) if r['id']==name),{})
   receipts.append({**old,'id':name,'url':url,'status':'saved_response_reused','bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'last_reused_at':t._stamp()});continue
  try:
   r=t.fetch(url);path.write_bytes(r.body)
   item={'id':name,'url':url,'status':'accessible','bytes':len(r.body),'sha256':hashlib.sha256(r.body).hexdigest(),'response_status':r.status,'response_url':r.url,'response_headers':{k:v for k,v in r.headers.items() if k.lower() in ['x-wp-total','x-wp-totalpages','content-type','etag','last-modified']},'observed_at':t._stamp()}
  except Exception as exc:item={'id':name,'url':url,'status':'access_blocked','error':str(exc),'observed_at':t._stamp()}
  receipts.append(item);persist();print(json.dumps(item),flush=True)
 persist()
 return receipts

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);p.add_argument('--only',nargs='+',choices=sorted(URLS));p.add_argument('--ledger',action='store_true');a=p.parse_args();write_discovery_ledger(a.output) if a.ledger else inspect(a.output,a.only)


def write_discovery_ledger(folder):
 """Expose planned lanes separately from actual source operations."""
 from datetime import datetime, timezone
 from .geography import configured_footprint, MUNICIPALITY_GROUPS
 folder=Path(folder);now=datetime.now(timezone.utc).isoformat()
 labels=[r['label'] for r in configured_footprint() if r['configured_runtime'] and 'toronto' in r['areas']]
 families=['municipal_directory','economic_development','employment_survey','open_data_locations','business_licences','chamber','bia','industrial_directory','manufacturers_association','franchise_locator','corporate_branch_locator','industrial_park_roster','installer_renovator_directory','appliance_dealer_directory']
 rows=[]
 def entry(key,scope,family,status,url,evidence,**extra):
  rows.append({'schema_version':1,'operation_id':'gta-'+key,'checked_at':now,'operational_area':'toronto','configured_labels':scope,'source_family':family,'status':status,'query_or_entry_url':url,'evidence_urls':evidence,'market_completeness_verified':False,**extra})
 for source_folder in ['bloor-annex-bia-factual-acquisition','college-promenade-bia-factual-acquisition','mount-pleasant-bia-factual-acquisition','islington-bia-factual-acquisition']:
  acquired=folder.parent/source_folder
  if not (acquired/'manifest.json').exists():continue
  m=json.loads((acquired/'manifest.json').read_text())
  entry(source_folder,['Toronto'],'bia','acquired_complete',m['source_url'],[m['source_url']]+([m['policy_url']] if m.get('policy_url') else []),source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit=m['record_unit'],acquired_raw_rows=m['raw_factual_rows'],reported_row_count=m.get('publisher_reported_total'),source_inventory_exhausted=True,publisher_scope='Exact published district directory collection; no complete municipality market or unique-company claim',scope_basis=m['exhaustion_scope'],artifact_paths=[str(acquired/'manifest.json'),str(acquired/'independent-verification.json')],next_action='Preserve profile/snapshot row keys, all duplicate names and missing-location fields; pending reviewable canonical adapter, research only')
 entry('forest-hill-automated-collection-policy-hold',['Toronto'],'bia','permission_required',URLS['forest-hill-offered-business-directory'],[URLS['forest-hill-offered-business-directory'],URLS['forest-hill-linked-terms']],publisher='Forest Hill Village BIA',rights_status='restricted',record_unit='Public BIA directory entry, no roster facts extracted',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='Actual linked terms prohibit systematic or automated data collection, scraping, extraction and harvesting without express written consent',rights_evidence_urls=[URLS['forest-hill-linked-terms']],artifact_paths=[str(folder/'toronto-neighbourhood-bia-directory-inspection/inspection.json')],next_action='Publisher written approval or independently licensed source facts, no access/terms bypass')
 for inspection in sorted(folder.glob('toronto-*-inspection/inspection.json')):
  if inspection.parent.name=='toronto-industrial-bia-entry-inspection':continue
  for receipt in json.loads(inspection.read_text()).get('receipts',[]):
   accessible=receipt['status'] in ['accessible','saved_response_reused']
   entry('entry-check-'+receipt['id'],['Toronto'],'bia','source_identified' if accessible else 'unavailable' if 'HTTP 404' in receipt.get('error','') else 'blocked',receipt['url'],[receipt['url']],rights_status='under_policy_review' if accessible else 'unverified_access_blocked',record_unit='Actual individual BIA publisher entry/policy/source inspection; not organisation acquisition',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason=receipt.get('error'),artifact_paths=[str(inspection)],source_response_sha256=receipt.get('sha256'),source_observed_at=receipt.get('observed_at'),next_action='Inspect actual offered roster and linked policy, then collect every eligible source row' if accessible else 'Resolve normal publisher route/policy; no access bypass and no business absence inferred')
 for inspection in sorted(folder.glob('west-north-gta-bia-*-inspection/inspection.json')):
  for receipt in json.loads(inspection.read_text()).get('receipts',[]):
   scope=['Burlington'] if receipt['id'].startswith('aldershot') else ['Oakville'] if receipt['id'].startswith('kerr') else ['Richmond Hill'] if receipt['id'].startswith('richmond') else ['Mississauga']
   accessible=receipt['status'] in ['accessible','saved_response_reused']
   entry('entry-check-'+receipt['id'],scope,'bia','source_identified' if accessible else 'blocked',receipt['url'],[receipt['url'],'https://www.ontario.ca/document/business-improvement-area-handbook/appendix-e-links-ontario-bia-websites'],rights_status='unreviewed',record_unit='Actually checked source-channel entry from official handbook; current publisher identity/reuse not inferred',acquired_raw_rows=0,source_inventory_exhausted=False,artifact_paths=[str(inspection)],source_response_sha256=receipt.get('sha256'),block_reason=receipt.get('error'),next_action='Verify current publisher identity, actually offered roster and linked policies; complete eligible pagination only')
 for cohort,label in [('port-credit-all-public-profile-acquisition','Mississauga'),('kerr-village-bia-factual-acquisition','Oakville'),('aldershot-six-category-directory-acquisition','Burlington')]:
  acquired=folder.parent/cohort
  if not (acquired/'manifest.json').exists():continue
  m=json.loads((acquired/'manifest.json').read_text());complete=m.get('status','completed')=='completed';count=m.get('raw_factual_rows',m.get('raw_factual_profile_rows'))
  entry(cohort,[label],'bia','acquired_complete' if complete else 'acquired_partial',m['source_url'],[m['source_url']],source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit=m.get('record_unit','Public organisation-profile observation, same publisher profileURL identity as index'),acquired_raw_rows=count,unique_source_ids=m.get('unique_source_ids',m.get('unique_snapshot_observation_keys')),reported_row_count=m.get('publisher_reported_row_count'),source_inventory_exhausted=m['source_inventory_exhausted'],publisher_scope='Exact published BIA district/profile/category inventories only; no whole municipality or complete market claim',scope_basis=m['exhaustion_scope'],artifact_paths=[str(acquired/'manifest.json'),str(acquired/'independent-verification.json')]+([str(acquired/'preferred-normalization.json')] if (acquired/'preferred-normalization.json').exists() else []),published_email_associations=m.get('published_email_associations',m.get('published_email_source_associations')),not_additional_company_count=m.get('not_additional_company_count',False),next_action='Pending canonical adapter review; preserve literal missing fields, all source keys and cross-category repeats; published mailboxes remain unchecked/research only')
 partial=folder.parent/'streetsville-native-html-partial-acquisition'
 if (partial/'manifest.json').exists():
  m=json.loads((partial/'manifest.json').read_text())
  entry('streetsville-native-main-index-partial',['Mississauga'],'bia','acquired_partial',m['source_url'],[m['source_url']],source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit=m['record_unit'],acquired_raw_rows=m['raw_factual_rows'],unique_source_ids=m['unique_native_main_index_ids'],source_inventory_exhausted=False,published_email_associations=m['published_email_associations'],block_reason=m['block_reason'],artifact_paths=[str(partial/'manifest.json')],next_action='Retain48 allowed visible main-index IDs; continue independently offered/allowed ordinary category routes, no disallowed AJAX endpoint bypass or complete inventory claim')
  entry('streetsville-native-public-form-robots-held',['Mississauga'],'bia','blocked',m['blocked_route'],[m['source_url'],m['blocked_route']],rights_status=m['rights_status'],record_unit='Documented public directory retrieval form, not acquired',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='Robots disallows actual public POST endpoint; no POST sent',artifact_paths=[str(folder.parent/'streetsville-public-form-probe/failure.json')],next_action='Keep route hold; ordinary actual publisher category pages are independent review lanes')
 partner=folder.parent/'gta-saved-explicit-relationship-recovery'
 if (partner/'manifest.json').exists():
  m=json.loads((partner/'manifest.json').read_text())
  entry('mcahn-saved-explicit-partnership',['Hamilton'],'installer_renovator_directory','covered_by_existing_source',m['source_url'],[m['source_url']],rights_status=m['rights_status'],record_unit=m['record_unit'],acquired_raw_rows=0,derived_explicit_relationship_claims=m['explicit_partnership_claims'],new_businesses_collected=0,source_inventory_exhausted=False,artifact_paths=[str(partner/'manifest.json')],next_action='Review listed_partner_of claim; no financial contract/current term/legal identity inferred; no MAIN writes')
 apbot_email=folder.parent/'apbot-public-company-email-recovery'
 if (apbot_email/'manifest.json').exists():
  m=json.loads((apbot_email/'manifest.json').read_text())
  entry('apbot-public-company-email-offline-recovery',['Ajax','Pickering'],'chamber','covered_by_existing_source',m['source_url'],[m['source_url']],source_id=m['source_id'],rights_status=m['rights_status'],record_unit=m['record_unit'],acquired_raw_rows=0,new_businesses_collected=0,derived_published_email_source_associations=m['published_email_source_associations'],derived_unique_published_email_strings=m['unique_published_email_strings'],source_inventory_exhausted=False,artifact_paths=[str(apbot_email/'manifest.json'),str(apbot_email/'independent-verification.json')],next_action='Central source-UUID mapping only; saved public client proves email rendering, mailbox/authority not checked and no new company counts')
 durham_email=folder.parent/'durham-licensed-layer-email-recovery'
 if (durham_email/'manifest.json').exists():
  m=json.loads((durham_email/'manifest.json').read_text())
  entry('durham-licensed-layer-literal-email-review',['Ajax','Oshawa','Pickering','Uxbridge','Whitby','Brock','Clarington','Scugog'],'employment_survey','covered_by_existing_source',m['source_licence_reference'],[m['source_licence_reference']],source_id=m['source_id'],rights_status='licensed_open',record_unit='Literal email in published business website/description field; null public flag retained and requires visibility review',acquired_raw_rows=0,new_businesses_collected=0,derived_email_source_associations=m['published_literal_email_source_associations'],requires_contact_visibility_review=True,source_inventory_exhausted=False,artifact_paths=[str(durham_email/'manifest.json')],next_action='Keep11 licensed-source facts separate from renderer/mailto-proved contacts; do not infer null ShowOnPublic as true/false or campaign eligibility')
 brock_partners=folder.parent/'gta-saved-community-partner-recovery'
 if (brock_partners/'manifest.json').exists():
  m=json.loads((brock_partners/'manifest.json').read_text())
  entry('brock-saved-organisation-community-partner-graph-recovery',['Brock'],'chamber','covered_by_existing_source','https://www.brockboardoftrade.com/sitemap.xml',['https://www.brockboardoftrade.com/sitemap.xml'],source_id=m['source_id'],rights_status=m['rights_status'],record_unit=m['record_unit'],acquired_raw_rows=0,new_businesses_collected=0,reused_partner_source_claims=m['source_reported_partner_claims'],actual_published_target_websites=m['actual_published_target_websites'],pipeline_status='pending_root_checkpoint_intake',source_inventory_exhausted=False,artifact_paths=[str(brock_partners/'manifest.json')],next_action='Operational intake after root checkpoint, preserving source claims and actual URLs; no financial sponsorship/current term/company identity inference')
 project_partners=folder.parent/'gta-bia-project-partner-recovery'
 if (project_partners/'manifest.json').exists():
  m=json.loads((project_partners/'manifest.json').read_text())
  entry('bia-first-party-project-partner-recovery',['Toronto'],'contractor_projects','source_reviewed','https://stepspublicart.org/project/accessible-art/',['https://stepspublicart.org/project/accessible-art/','https://www.bloorannex.ca/home/public-spaces'],rights_status=m['rights_status'],record_unit='Explicit organisation project-partner statements with actual linked targets',acquired_raw_rows=0,new_businesses_collected=0,derived_project_partner_claims=m['source_reported_project_partner_claims'],pipeline_status=m['pipeline_status'],source_inventory_exhausted=False,artifact_paths=[str(project_partners/'manifest.json')],next_action='Queue at root checkpoint; project-specific unverified relationships, no people or company-location/financial inference')
 construction=folder.parent/'mcahn-construction-factual-acquisition'
 if (construction/'manifest.json').exists():
  m=json.loads((construction/'manifest.json').read_text())
  entry('mcahn-business-sections',['Hamilton'],'installer_renovator_directory','acquired_complete',m['source_url'],[m['source_url'],'https://www.mcahamiltonniagara.org/'],source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit=m['record_unit'],publisher_scope='Explicit Our Members and Associate Members business sections; published addresses outside Hamilton retained, no provincewide coverage claim',source_inventory_exhausted=True,acquired_raw_rows=m['rows'],reported_row_count=None,artifact_paths=[str(construction/'manifest.json')],next_action='Research-only source member claims; no board/contact people retained or campaign eligibility inferred')
 apbot=folder.parent/'ajax-pickering-board-factual-acquisition'
 if (apbot/'manifest.json').exists():
  m=json.loads((apbot/'manifest.json').read_text())
  entry('apbot-public-company-member-payload',['Ajax','Pickering'],'chamber','acquired_complete',m['source_url'],[m['source_url'],URLS['ajax-pickering-board-home'],URLS['ajax-pickering-directory-public-client']],source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit=m['record_unit'],acquired_raw_rows=m['company_member_factual_rows'],unique_source_ids=m['unique_native_member_ids'],raw_public_member_payload_ids=m['public_member_payload_rows'],explicit_individual_member_ids_only=m['explicit_individual_members_excluded'],hidden_address_company_rows=m['hidden_address_company_rows'],source_inventory_exhausted=True,publisher_scope='Complete anonymous current-company member payload; association members may publish other localities, not an Ajax/Pickering census',artifact_paths=[str(apbot/'manifest.json'),str(apbot/'independent-verification.json')],next_action='Keep membership as source claim; hidden addresses/coordinates and named contacts excluded')
 for name,label in [('downtown-milton-bia-public-api-acquisition','Milton'),('burlington-downtown-bia-public-api-acquisition','Burlington')]:
  acquired=folder.parent/name
  if (acquired/'manifest.json').exists():
   m=json.loads((acquired/'manifest.json').read_text())
   entry(name,[label],'bia','acquired_complete',m['source_url'],[m['directory_url'],m['api_index_url'],m['source_url']],source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit=m['record_unit'],acquired_raw_rows=m['raw_factual_rows'],unique_source_ids=m['unique_native_ids'],reported_row_count=m['reported_row_count'],source_inventory_exhausted=True,publisher_scope='Exact published BIA public API collection; no whole municipality coverage inferred',scope_basis='Actual directory links public API index; context=view/status=publish/select facts; count/header/native-ID reconciliation and terminal recheck',artifact_paths=[str(acquired/'manifest.json'),str(acquired/'independent-verification.json')],next_action='Retain all source records including missing-location/website rows; source categories remain publisher categories, no company/tenant assertion')
 bowmanville=folder.parent/'bowmanville-bia-factual-acquisition'
 if (bowmanville/'manifest.json').exists():
  m=json.loads((bowmanville/'manifest.json').read_text())
  entry('bowmanville-public-embedded-roster',['Clarington'],'bia','acquired_complete',m['source_url'],[m['source_url'],URLS['bowmanville-bia-public-directory-client']],source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit=m['record_unit'],acquired_raw_rows=m['acquired_raw_factual_rows'],unique_source_ids=m['unique_native_rendered_ids'],research_candidate_rows=m['organisation_research_candidates'],property_status_placeholders_retained=m['property_status_placeholders_retained'],reported_row_count=None,source_inventory_exhausted=True,publisher_scope='Downtown Bowmanville BIA public roster only; Bowmanville is community context, not a newly configured service label or all Clarington',scope_basis='All172 embedded company cards; actual offered script clones public #companies data to visible directory',artifact_paths=[str(bowmanville/'manifest.json'),str(bowmanville/'independent-verification.json'),str(bowmanville/'public-display-proof.json')],next_action='Retain vacant/closed/displaced observations;13 address-only placeholders stay separate from159 named organisation/site candidates; no city or current operation filled from footer')
 brock=folder.parent/'brock-published-profile-acquisition'
 if (brock/'manifest.json').exists():
  m=json.loads((brock/'manifest.json').read_text())
  for kind,source,count in [('member',m['source_ids'][0],m['member_factual_rows']),('partner',m['source_ids'][1],m['community_partner_profile_rows'])]:
   entry('brock-published-'+kind+'-profiles',['Brock'],'chamber','acquired_complete',m['source_url'],[m['source_url'],URLS['brock-board-robots-sitemap-proof'],URLS['brock-offered-business-member-sitemap'] if kind=='member' else URLS['brock-offered-community-partner-sitemap']],source_id=source,publisher=m['publisher'],rights_status=m['rights_status'],record_unit='Published organisation member profile' if kind=='member' else 'Published community-organisation partner profile, no financial sponsorship inferred',acquired_raw_rows=count,unique_source_ids=count,reported_row_count=None,source_inventory_exhausted=True,reused_source_rows=100 if kind=='member' else 0,new_source_rows=7 if kind=='member' else count,publisher_scope='Exact two publicly offered organisation sitemap inventories; no private/unlisted membership or complete Brock market claim',scope_basis='Robots links sitemap index; index explicitly offers business-members and community-partners maps. No personal user/author maps requested. Terminal URL sets rechecked',artifact_paths=[str(brock/'manifest.json'),str(brock/'independent-verification.json')],next_action='Promote full107 member cohort once, not additional old100-card prefix; keep member/community-partner relationships as source claims and all unknown localities unfilled')
 for acquired_name,kind in [('emery-village-public-api-acquisition','api'),('emery-village-legacy-index-acquisition','legacy_index'),('danforth-village-public-directory-acquisition','api')]:
  acquired=folder.parent/acquired_name
  if not (acquired/'manifest.json').exists():continue
  m=json.loads((acquired/'manifest.json').read_text())
  entry(acquired_name,['Toronto'],'bia','acquired_complete',m['source_url'],list(dict.fromkeys([m['source_url']]+[m[x] for x in ['directory_url','api_index_url','public_table_url'] if x in m])),source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit=m.get('record_unit','Published BIA name/profile URL observation; not verified legal company or operating site'),acquired_raw_rows=m['raw_factual_rows'],unique_source_ids=m.get('unique_native_ids',m.get('unique_offered_profile_urls')),reported_row_count=m.get('reported_row_count'),source_inventory_exhausted=True,publisher_scope='Exact published collection only; legacy index and current API are overlapping source observations, not additive unique companies',scope_basis=m.get('exhaustion_scope'),artifact_paths=[str(acquired/'manifest.json'),str(acquired/'independent-verification.json')],next_action='Keep missing locations unknown and preserve source IDs/dates; promotion adapter pending, no company/membership/occupancy verification implied')
 entry('tabia-index-permission-held',['Toronto'],'bia','permission_required',URLS['tabia-publisher-bia-index'],[URLS['tabia-publisher-bia-index'],URLS['tabia-linked-terms'],URLS['tabia-linked-privacy']],rights_status='restricted',record_unit='Association BIA source-channel index, not companies',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='Actual linked terms prohibit commercial use and copying without written permission; restricted index/map content not extracted',next_action='Use independently licensed City polygon metadata and official Ontario handbook source-channel metadata; inspect each actual publisher independently')
 for key in ['duke-heights-offered-directory','danforth-mosaic-offered-retail']:
  entry(key+'-held',['Toronto'],'bia','blocked',URLS[key],[URLS[key]],rights_status='unverified_access_blocked',record_unit='Public BIA directory entry, no rows acquired',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='Robots HTTP403' if key.startswith('duke') else 'Robots response is HTML rather than an interpretable robots policy',artifact_paths=[str(folder/'toronto-industrial-bia-entry-inspection/inspection.json')],next_action='Publisher-authorised route or normal policy resolution; no bypass or market absence inferred')
 metadata=folder.parent/'bia-source-discovery-queue/ontario-official-bia-source-channels.json'
 if metadata.exists():
  m=json.loads(metadata.read_text())
  entry('official-bia-source-channel-metadata',['Toronto'],'bia','source_identified',m['source_url'],[m['source_url']],record_unit=m['record_unit'],acquired_raw_rows=0,source_channel_metadata_rows=m['source_index_rows'],new_businesses_collected=0,source_inventory_exhausted=False,artifact_paths=[str(metadata)],next_action='Provincewide source index metadata reused only; target liveness/rights and source rows require separate real checks, no additional Ontario company counts')
 for key,hold_labels,url,reason in [('north-durham-member-roster-held',['Scugog','Uxbridge','Brock'],URLS['north-durham-chamber-directory'],'Actual public member-directory HTTP403; ordinary chamber homepage available but no roster acquired'),('clarington-member-roster-held',['Clarington'],URLS['clarington-board-directory'],'Actual public member-directory HTTP403; ordinary homepage is not a substitute full membership roster'),('whitby-company-widget-held',['Whitby'],URLS['whitby-offered-widget'],'Actually offered public corporate-membership widget HTTP403; no private API or alternate host bypass attempted')]:
  entry(key,hold_labels,'chamber','blocked',url,[url],rights_status='unverified_or_access_blocked',acquired_raw_rows=0,source_inventory_exhausted=False,record_unit='Public company member directory entry point, no row acquisition',block_reason=reason,artifact_paths=[str(folder/'durham-rural-trade-bia-inspection/inspection.json'),str(folder/'halton-bia-whitby-widget-inspection/inspection.json')],next_action='Normal publisher-authorised route or independently offered permitted directory; no membership absence or city completion inferred')
 for key,url,policy,reason in [('tasco-branch-rights-held',URLS['tasco-offered-store-locations'],URLS['tasco-linked-terms'],'Linked terms Rights of information published limit access/downloads to personal non-commercial use'),('ta-appliance-branch-automation-held',URLS['ta-appliances-contact-locations'],URLS['ta-linked-service-terms'],'Linked service terms prohibit spider/crawl/scrape and copying without written permission'),('appliance-canada-branch-data-mining-held',URLS['appliance-canada-location-faq'],URLS['appliance-canada-linked-terms'],'Linked terms explicitly prohibit scraping/data-mining without permission'),('canadian-appliance-source-locator-access-held',URLS['canadian-appliance-official-locator'],None,'Actual official locator HTTP403; no route/header/language-host bypass attempted')]:
  entry(key,['GTA'],'appliance_dealer_directory','permission_required' if policy else 'blocked',url,[u for u in [url,policy] if u],rights_status='restricted' if policy else 'unverified_access_blocked',acquired_raw_rows=0,reported_row_count=None,source_inventory_exhausted=False,record_unit='Publisher appliance-retailer store/branch locator; no location facts normalised',publisher_scope='Whole-chain source candidate; any future source reuse must retain actual Ontario/Canada scope rather than infer all31 GTA labels covered',block_reason=reason,rights_evidence_urls=[policy] if policy else [],artifact_paths=[str(folder/'appliance-branch-policy-entry-inspection/inspection.json'),str(folder/'appliance-linked-policy-review/inspection.json')],next_action='Publisher written approval or independently licensed facts; reuse existing permitted provider/directory rows without copying restricted locator facts')
 ordinary=folder.parent/'downtown-milton-bia-factual-acquisition'
 if (ordinary/'checkpoint.json').exists():
  entry('downtown-milton-ordinary-pagination-repeats',['Milton'],'bia','acquired_partial',URLS['milton-downtown-bia-directory'],[URLS['milton-downtown-bia-directory'],URLS['milton-downtown-bia-directory']+'page/2/'],source_id='downtown-milton-bia-public-directory',publisher='Downtown Milton BIA',rights_status='limited_factual_review_only',acquired_raw_rows=24,unique_source_ids=12,reported_row_count=174,count_definition='Two captured ordinary HTML pages repeat the same12profileURLs; these are repeated appearances, not24distinct businesses',source_inventory_exhausted=False,block_reason='Actually offered page2 returns the first12again; collector stops rather than claims174complete',artifact_paths=[str(ordinary/'checkpoint.json')],next_action='Retain immutable broken-route proof; separate permitted public API cohort reconciles all174IDs without reusing duplicate HTML observations as new businesses')
 entry('ajax-public-directory-policy-held',['Ajax'],'municipal_directory','blocked',URLS['ajax-municipal-directory'],[URLS['ajax-municipal-directory'],URLS['ajax-public-client-script'],URLS['ajax-public-directory-service'],URLS['ajax-current-privacy']],rights_status='restricted_pending_specific_open_dataset_licence',acquired_raw_rows=0,source_inventory_exhausted=False,publisher='Town of Ajax',record_unit='Public opt-in business-directory observation; no business rows acquired',block_reason='Current Town website terms require prior written consent to copy information; specific directory open-data licence not yet established',artifact_paths=[str(folder/'durham-public-schema-review/inspection.json'),str(folder/'durham-halton-alternate-policy-review/inspection.json')],next_action='Check actually publisher-offered open-data licence and dataset applicability; if permitted use exact PUBLISH=Yes and honor ADDRESS_PUB, no private/status/person fields')
 entry('milton-chamber-offered-routes-review',['Milton'],'chamber','source_identified',URLS['milton-chamber-directory'],[URLS['milton-chamber-directory'],URLS['milton-chamber-policy'],URLS['milton-chamber-a'],URLS['milton-offered-construction-category']],rights_status='unverified',acquired_raw_rows=0,source_inventory_exhausted=False,record_unit='Public member directory entry/index',block_reason='Actual linked policy404; offered alphabetical route robots-disallowed. Offered category route separately under review, no roster collected',artifact_paths=[str(folder/'halton-durham-directory-inspection/inspection.json'),str(folder/'halton-durham-linked-policies/inspection.json')],next_action='Resolve current publisher policy; only actually offered and independently robots-allowed routes eligible')
 for key,label,url,policy,reason in [('oakville-chamber-public-directory','Oakville',URLS['oakville-chamber-directory'],URLS['oakville-chamber-policy'],'Actual directory widget host and normal pagination not yet inspected; FAQ declines mass-email/cold-call directory copies, no outreach requested'),('whitby-chamber-public-directory','Whitby',URLS['whitby-chamber-directory'],URLS['whitby-chamber-policy'],'Publisher embeds GlueUp company-membership widget; full linked privacy document and embedded host policy/access under review')]:
  entry(key,[label],'chamber','source_identified',url,[url,policy],rights_status='under_review',acquired_raw_rows=0,source_inventory_exhausted=False,record_unit='Public member directory entry',block_reason=reason,artifact_paths=[str(folder/'halton-durham-directory-inspection/inspection.json'),str(folder/'halton-durham-linked-policies/inspection.json')],next_action='Inspect actual normal public widget and linked policies; no website-size gate or default50-results completeness claim')
 entry('tca-public-directory-policy-held',['GTA'],'industrial_directory','blocked',URLS['tca-member-directory'],[URLS['tca-member-directory'],URLS['tca-terms'],URLS['tca-privacy']],publisher='Toronto Construction Association',rights_status='restricted',record_unit='Advertised public construction company-member directory; not acquired',acquired_raw_rows=0,reported_row_count=None,publisher_advertised_approximate_members=1800,source_inventory_exhausted=False,block_reason='Linked terms Limited Licence permits personal non-commercial copies only; no commercial raw collection',artifact_paths=[str(folder/'construction-policy-inspection/inspection.json')],next_action='Publisher written permission or separately licensed source; no automated roster extraction')
 entry('mcat-public-contractor-directory-held',['GTA'],'installer_renovator_directory','blocked',URLS['mcat-directory'],[URLS['mcat-directory']],publisher='Mechanical Contractors Association of Toronto',rights_status='unverified',record_unit='Public contractor member listing; not acquired',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='HTTP403 on actual public member directory',artifact_paths=[str(folder/'construction-policy-inspection/inspection.json')],next_action='Normal publisher-authorised/manual route; no access bypass')
 bild=folder.parent/'bild-construction-factual-acquisition'
 if (bild/'checkpoint.json').exists():
  state=json.loads((bild/'checkpoint.json').read_text());complete=(bild/'manifest.json').exists();m=json.loads((bild/'manifest.json').read_text()) if complete else {}
  entry('bild-public-current-member-form',['GTA'],'installer_renovator_directory','acquired_complete' if complete else 'acquired_partial',URLS['bild-member-directory'],[URLS['bild-member-directory'],URLS['bild-policy'],URLS['bild-public-client-script'],URLS['bild-robots-policy']],source_id='bild-public-member-directory',publisher='Building Industry and Land Development Association',rights_status='limited_factual_review_only',record_unit='Published current company-member card, not verified legal company/site',source_inventory_exhausted=complete,acquired_raw_rows=m.get('raw_factual_rows'),reported_row_count=None,pages_saved=len(state['pages']),publisher_scope='Unfiltered public BILD Find a Member Load More form; addresses/phone not published in cards',artifact_paths=[str(bild/'manifest.json' if complete else bild/'checkpoint.json')],next_action='Complete exact documented anonymous pagination to terminal empty page with first-page identity recheck; raw cards/receipts checkpointed')
 for label in labels:
  for family in families:
   key=hashlib.sha256((label+'|'+family).encode()).hexdigest()[:20]
   entry('unsearched-'+key,[label],family,'unsearched','',[],next_action='Execute source-family discovery; this planned lane is not a completed search',industry_families=['*'],planned_lane=True)
 toronto=folder.parent/'toronto-licences-full-next-release';m=json.loads((toronto/'manifest.json').read_text())
 entry('toronto-full-licences',['Toronto'],'business_licences','acquired_complete',m['dataset_portal'],[m['dataset_portal'],m['source_url'],m['licence_url']],source_id=m['source_id'],rights_status='licensed_open',record_unit='licence/permit observation; not unique company',publisher='City of Toronto',publisher_scope='Complete documented City licence/permit CSV, including cancelled and malformed rows',reported_row_count=160102,acquired_raw_rows=m['raw_rows'],unique_source_ids=m['native_object_ids'],count_definition='native publisher _id, all rows;37499 usable no-recorded-cancellation candidates;122599cancelled;4quarantined',source_inventory_exhausted=True,artifact_paths=[str(toronto/'manifest.json')],source_publication_or_reference_period=m['source_currency'],next_action='Retain immutable full source; promote candidates only by single-writer release ordering')
 york=[x for x in MUNICIPALITY_GROUPS['York Region'].split('|') if x in labels]
 entry('york-2024-api-blocked',york,'employment_survey','blocked',URLS['york-layer'],[URLS['york-item'],URLS['york-open-data'],URLS['york-licence-pdf']],source_id='york-business-directory-2024',rights_status='licensed_open',rights_evidence_urls=[URLS['york-licence-pdf']],publisher='York Region',record_unit='surveyed business-location observation',publisher_scope='York Region surveyed businesses; official metadata excludes farm/home-based businesses, while stale2022 FAQ mentions participating home-based businesses',scope_basis='Publisher describes all surveyed businesses across York Region; municipality memberships are configured geographic routing only',acquired_raw_rows=0,reported_row_count=None,source_inventory_exhausted=False,block_reason='HTTP403 on services1.arcgis.com/robots.txt; API never queried',artifact_paths=[str(folder/'inspection.json'),str(folder/'bulk-route-check/york-licence-pdf.response')],source_publication_or_reference_period='2024 title; mixed2022 FAQ retained; per-record dates unavailable',next_action='Find publisher-documented standalone current Excel; otherwise permitted manual download; do not bypass robots')
 entry('mississauga-2025-api-blocked',['Mississauga'],'employment_survey','blocked',URLS['mississauga-directory-layer'],[URLS['mississauga-directories'],URLS['mississauga-directory-item']],source_id='mississauga-business-directory-2025',publisher='City of Mississauga',rights_status='unverified',record_unit='voluntary business-directory location observation',publisher_scope='Only businesses agreeing to inclusion in Mississauga directory',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='HTTP403 on services6.arcgis.com/robots.txt; API never queried',artifact_paths=[str(folder/'alternate-bulk-metadata/inspection.json')],next_action='Review official terms PDF and publisher-linked standalone Excel; no API bypass')
 entry('hamilton-survey-context',['Hamilton'],'employment_survey','search_attempted_no_candidate',URLS['hamilton-survey'],[URLS['hamilton-survey'],URLS['hamilton-open-data']],rights_status='unverified',acquired_raw_rows=0,record_unit='Survey methodology page, no acquired business roster',next_action='Inspect official catalogue and economic-development directories for an eligible roster; methodology does not establish published business rows')
 config=json.loads((Path(__file__).parent/'config/sources.json').read_text());config=config if isinstance(config,list) else config['sources']
 for ident in ['vaughan-yres-2025','brampton-economic-development']:
  s=next(s for s in config if s['id']==ident);scope=[x for x in s['geography_scope'] if x in labels]
  entry(ident+'-existing-policy',scope,{'open_data_business_locations':'open_data_locations'}.get(s['source_type'],s['source_type']),'permission_required' if s['rights_status']=='restricted' else 'blocked',s['source_url'],[s['source_url']],source_id=ident,rights_status=s['rights_status'],acquired_raw_rows=0,source_inventory_exhausted=False,block_reason=s.get('notes'),next_action='Retain policy/access hold; publisher permission/manual route only; no prohibited automated retrieval')
 # Publisher-identified western GTA lanes; source visibility is not reuse permission.
 entry('caledon-directory-policy-hold',['Caledon'],'municipal_directory','permission_required',URLS['caledon-directory'],[URLS['caledon-directory'],URLS['caledon-policy']],publisher='Town of Caledon',rights_status='restricted',record_unit='published directory business-location observation',reported_row_count=None,reported_page_count=192,inspected_entry_page_rows=10,acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='Linked Town policy requires express written permission to duplicate website material; no192-page collection performed',artifact_paths=[str(folder/'west-gta-inspection/caledon-directory.response')],next_action='Seek permitted bulk/licensed route or publisher permission; no outreach is authorised by this task')
 entry('caledon-chamber-robots',['Caledon'],'chamber','blocked',URLS['caledon-chamber'],[URLS['caledon-chamber']],rights_status='unverified',record_unit='member-directory observation',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='HTTP403 at chamber robots.txt; no roster requested',artifact_paths=[str(folder/'west-gta-inspection/inspection.json')],next_action='Publisher-authorised bulk/manual route; no access bypass')
 entry('burlington-powerbi-directory',['Burlington'],'employment_survey','source_identified',URLS['burlington-directory'],[URLS['burlington-directory']],publisher='Burlington Economic Development and Tourism',rights_status='unverified',record_unit='Halton Employment Survey directory location observation',acquired_raw_rows=0,source_inventory_exhausted=False,publisher_scope='Burlington business directory derived from Halton Employment Survey',artifact_paths=[str(folder/'west-gta-inspection/burlington-directory.response')],next_action='Find documented public bulk and review terms; embedded PowerBI is not an acquired roster')
 entry('milton-data-host',['Milton'],'open_data_locations','unavailable',URLS['milton-data'],[URLS['milton-data']],rights_status='unverified',acquired_raw_rows=0,source_inventory_exhausted=False,block_reason='data.milton.ca DNS resolution failed during guarded inspection',artifact_paths=[str(folder/'west-gta-inspection/inspection.json')],next_action='Check current official Town maps/open-data entry point; no inference that no businesses exist')
 entry('halton-hills-business-report',['Halton Hills'],'economic_development','source_identified',URLS['halton-hills-data'],[URLS['halton-hills-data'],'https://properties.zoomprospector.com/haltonhillson/community/Halton-Hills--Ontario/7924015/business'],rights_status='unverified',acquired_raw_rows=0,source_inventory_exhausted=False,record_unit='Third-party business-report source; underlying row licence unresolved',artifact_paths=[str(folder/'west-gta-inspection/halton-hills-data.response')],next_action='Review published report and third-party reuse/access; no hidden API probing')
 for key,label,url in [('downtown-yonge-directory','Downtown Yonge',URLS['downtown-yonge-directory']),('bloor-west-directory','Bloor West Village',URLS['bloor-west-directory']),('liberty-village-directory','Liberty Village',URLS['liberty-village-directory'])]:
  entry(key,['Toronto'],'bia','source_identified',url,[url],rights_status='unverified',publisher_scope=label+' BIA public directory, not whole Toronto',acquired_raw_rows=0,source_inventory_exhausted=False,next_action='Guarded robots/policy inspection pending2GiB capacity preflight; public search identifies source only')
 entry('hamilton-food-licences-open-but-blocked',['Hamilton'],'business_licences','blocked',URLS['hamilton-food-licences-item'],[URLS['hamilton-food-licences-item'],URLS['hamilton-food-licences-service'],URLS['hamilton-data-licence']],source_id='hamilton-licensed-food-establishments',publisher='City of Hamilton / OpenHamilton',rights_status='licensed_open',rights_evidence_urls=[URLS['hamilton-data-licence']],acquired_raw_rows=0,source_inventory_exhausted=False,record_unit='food establishment licence/location observation',block_reason='services.arcgis.com/robots.txt returns403; linked acceptable-use page separately403; no feature request attempted',artifact_paths=[str(folder/'halton-hamilton-policy/hamilton-food-licences-item.response'),str(folder/'factual-route-policy-2/inspection.json')],next_action='Find an independently permitted publisher-documented bulk download; do not proxy blocked API')
 entry('halton-hills-historical-public-directory',['Halton Hills','Milton'],'municipal_directory','source_reviewed',URLS['halton-hills-directory-layer'],[URLS['halton-hills-directory-layer'],URLS['halton-hills-current-policy'],URLS['halton-hills-directory-count'],URLS['halton-hills-directory-municipalities']],publisher='Town of Halton Hills public map; data credited to Halton Region',rights_status='limited_factual_review_only',rights_evidence_urls=[URLS['halton-hills-current-policy']],record_unit='historical public business-directory location observation',reported_row_count=1442,acquired_raw_rows=0,source_inventory_exhausted=False,publisher_scope='Layer includes published Halton Hills and Milton labels; neither whole Milton nor whole Halton coverage is established',scope_basis='Distinct values of publisher Busi_Municipality; no inferred parent-directory completeness',source_publication_or_reference_period='2021 survey with carry-forward; copyright2022-07-26',artifact_paths=[str(folder/'halton-directory-count-review/inspection.json')],next_action='Count/ID-reconciled minimal factual acquisition prepared; await single bulk slot and2GiB preflight; omit activity narrative')
 york_folder=folder.parent/'york-2024-publisher-html-acquisition'
 if (york_folder/'manifest.json').exists():
  m=json.loads((york_folder/'manifest.json').read_text())
  entry('york-2024-offered-static-lists',[x['municipality'] for x in m['collections']],'employment_survey','acquired_complete',m['source_url'],[m['source_url'],m['licence_url'],URLS['york-item']],source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit='Published2024 establishment listing/profile; not verified company',reported_row_count=None,acquired_raw_rows=m['raw_listing_appearances'],unique_source_ids=m['unique_profile_urls'],count_definition='All listing anchors across nine actually offered All Businesses HTML pages; raw SHA/reparse proof; no upstream API total supplied',source_inventory_exhausted=True,source_publication_or_reference_period='2024 survey, explicitly printed on every municipality page',publisher_scope='Nine published static municipality lists only; blocked ArcGIS/API count/ID equivalence unverified',scope_basis='Actual root municipality links and per-municipality All Businesses links; exact page headers supply municipality context',artifact_paths=[str(york_folder/'manifest.json'),str(york_folder/'derived/independent-verification.json')],next_action='Retain licensed raw facts; keep parcel IDs distinct from listing IDs and retain upstream API-access hold')
 halton_folder=folder.parent/'halton-hills-factual-acquisition'
 if (halton_folder/'manifest.json').exists():
  m=json.loads((halton_folder/'manifest.json').read_text())
  entry('halton-hills-historical-public-directory-acquired',['Halton Hills'],'municipal_directory','acquired_complete',m['source_url'],[m['source_url'],m['policy_url']],source_id=m['source_id'],rights_status=m['rights_status'],record_unit=m['record_unit'],reported_row_count=m['expected_count'],acquired_raw_rows=m['raw_factual_rows'],unique_source_ids=m['unique_native_ids'],source_inventory_exhausted=True,publisher_scope=m['publisher_scope'],scope_basis='1439 publisher Halton Hills rows plus3 incidental Milton rows; no complete Milton coverage claim',incidental_published_labels=['Milton'],source_publication_or_reference_period=m['reference_period'],artifact_paths=[str(halton_folder/'manifest.json'),str(halton_folder/'independent-verification.json')],next_action='Internal factual research only; historical/current-operator review remains required')
 chamber_folder=folder.parent/'hamilton-chamber-factual-acquisition'
 if (chamber_folder/'manifest.json').exists():
  m=json.loads((chamber_folder/'manifest.json').read_text())
  entry('hamilton-chamber-public-directory-complete',['Hamilton'],'chamber','acquired_complete',m['source_url'],[m['source_url'],URLS['hamilton-chamber-terms'],URLS['hamilton-chamber-privacy']],source_id=m['source_id'],publisher=m['publisher'],rights_status=m['rights_status'],record_unit='Public business-member directory listing; membership/physical presence independently unverified',reported_row_count=None,acquired_raw_rows=m['raw_factual_rows'],unique_source_ids=m['unique_profile_ids'],source_inventory_exhausted=True,count_definition='All82 offered public index pages,811 profile IDs, terminal first-page ID/page-count recheck',publisher_scope='Chamber membership source; member addresses can be outside Hamilton',artifact_paths=[str(chamber_folder/'manifest.json'),str(chamber_folder/'preferred-normalization.json')],next_action='Use preferred parser2 normalization; original source records preserved, no duplicate billing or unsupported street-as-city values')
 entry('markham-board-directory-access',['Markham'],'chamber','blocked',URLS['markham-board-directory'],[URLS['markham-board-directory']],rights_status='unverified',acquired_raw_rows=0,source_inventory_exhausted=False,record_unit='Public member directory entry point',block_reason='HTTP403 on actual directory; no roster acquired',artifact_paths=[str(folder/'chamber-policy-inspection/inspection.json')],next_action='Publisher-authorised normal/manual route; no access bypass')
 entry('vaughan-chamber-policy-unresolved',['Vaughan'],'chamber','source_identified',URLS['vaughan-chamber-directory'],[URLS['vaughan-chamber-directory'],URLS['vaughan-chamber-privacy']],rights_status='unverified',acquired_raw_rows=0,source_inventory_exhausted=False,record_unit='Public chamber category index; business roster not acquired',block_reason='Directory host accessible but actual linked policy host robots403; review incomplete',artifact_paths=[str(folder/'chamber-linked-policies/inspection.json')],next_action='Find independently publisher-offered accessible policy/normal factual roster; do not reuse the separate City restricted licence as authority')
 entry('brampton-board-offered-routes-blocked',['Brampton'],'chamber','blocked',URLS['brampton-board-public-directory'],[URLS['brampton-board-home'],URLS['brampton-board-public-directory'],URLS['brampton-board-offered-legacy-directory'],URLS['brampton-board-privacy']],rights_status='limited_factual_review_only_if_access_permitted',acquired_raw_rows=0,source_inventory_exhausted=False,record_unit='Public member directory; no row-level acquisition',block_reason='Current offered member-directory HTTP403; separately actually offered legacy business.bramptonbot.com directory has expired TLS certificate',artifact_paths=[str(folder/'chamber-linked-policies/inspection.json'),str(folder/'publisher-offered-alternatives/inspection.json')],next_action='Publisher fix/manual normal route; no TLS downgrade or host/proxy bypass')
 factual=folder.parent/'toronto-bia-factual-acquisition'
 if factual.exists():
  for manifest_path in sorted(factual.glob('*/manifest.json')):
   m=json.loads(manifest_path.read_text());key=manifest_path.parent.name
   entry('bia-factual-'+key,['Toronto'],'bia','acquired_complete',m['source_url'],[u for u in [m['source_url'],m.get('policy_url'),m.get('original_directory_url')] if u],source_id=m['source_id'],rights_status=m['rights_status'],record_unit='Public BIA business-directory listing; not verified company/member',publisher=m['publisher'],publisher_scope=m['publisher']+' listed businesses only',acquired_raw_rows=m['acquired_raw_factual_observations'],unique_source_ids=m.get('unique_native_ids',m.get('unique_profile_ids')),reported_row_count=m.get('reported_row_count'),source_inventory_exhausted=m['source_inventory_exhausted'],artifact_paths=[str(manifest_path)],next_action='Keep source facts separate; raw street/city only when publisher record prints them; no footer-address or membership inference')
 civic=folder.parent/'toronto-civic-raw-acquisition'
 if civic.exists():
  for status_path in sorted(civic.glob('*/acquisition-status.json')):
   acquired=json.loads(status_path.read_text());dataset=acquired['dataset'];spec={'dinesafe':('open_data_locations','food-establishment inspection/infraction observation'),'bodysafe':('business_licences','personal-service inspection/infraction observation'),'business-improvement-areas':('bia','BIA boundary/association record')}[dataset]
   entry('toronto-civic-'+dataset,['Toronto'],spec[0],acquired['status'],'https://open.toronto.ca/dataset/'+dataset+'/',[u for u in ['https://open.toronto.ca/dataset/'+dataset+'/',acquired.get('source_url'),'https://open.toronto.ca/open-data-licence/'] if u],source_id=acquired.get('source_id'),rights_status=acquired.get('rights_status','licensed_open_portal_evidence'),record_unit=spec[1],reported_row_count=acquired.get('reported_row_count'),acquired_raw_rows=acquired.get('raw_rows'),unique_source_ids=acquired.get('native_object_ids'),source_inventory_exhausted=acquired.get('source_inventory_exhausted',False),artifact_paths=[str(status_path)],block_reason=acquired.get('block_reason'),next_action='Retain all source observations; names/addresses are research facts, inspections and polygons are not unique companies')
 path=folder/'gta-discovery-ledger.jsonl'
 with path.open('w') as f:
  for row in rows:f.write(json.dumps(row,ensure_ascii=False)+'\n')
 save(folder/'ledger-summary.json',{'configured_runtime_labels':len(labels),'planned_label_family_lanes':len(labels)*len(families),'actual_source_operations':len(rows)-len(labels)*len(families),'ledger_rows':len(rows),'planned_lanes_are_not_executed_searches':True,'market_completeness_verified':False,'families_owned':families,'other_families_owned_by_other_agents':True})
 return path


if __name__=="__main__":main()
