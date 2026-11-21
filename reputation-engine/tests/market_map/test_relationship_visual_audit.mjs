import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSlots,gridBounds} from '../../scripts/market_map/relationship_visual_audit.mjs';

test('screenshot spans overflowing lower rows instead of parent container height',()=>{
 const box=gridBounds([{visible:true,bounding_box:{x:10,y:20,width:200,height:60}},{visible:true,bounding_box:{x:400,y:1400,width:216,height:60}}]);
 assert.deepEqual(box,{x:6,y:16,width:614,height:1448});
});

test('blank labels still counted; load failure and absent links remain explicit',()=>{
 const slots=[{ordinal:1,src_attribute:'blank.png',anchor_href:null,visible:true,complete:true,natural_width:50,natural_height:20},
  {ordinal:2,src_attribute:'failed.png',anchor_href:'https://published.test',visible:true,complete:true,natural_width:0,natural_height:0}];
 const reviewed=[{published_img_src:'blank.png',published_anchor_href:null},{published_img_src:'failed.png',published_anchor_href:'https://published.test'}];
 assert.deepEqual(compareSlots(slots,reviewed),{rendered_slots:2,reviewed_slots:2,exact_source_link_matches:2,visible_slots:2,loaded_slots:1,missing_or_failed_slots:[2]});
});

test('changed href or omitted image cannot count as exact match',()=>{
 const result=compareSlots([{ordinal:1,src_attribute:'a.png',anchor_href:'https://changed.test',visible:false,complete:false}],
  [{published_img_src:'a.png',published_anchor_href:'https://original.test'},{published_img_src:'missing.png'}]);
 assert.equal(result.exact_source_link_matches,0);assert.equal(result.rendered_slots,1);assert.equal(result.reviewed_slots,2);
 assert.deepEqual(result.missing_or_failed_slots,[1]);
});
