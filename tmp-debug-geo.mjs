process.env.NO_PROXY='*';process.env.no_proxy='*';process.env.HTTPS_PROXY='';process.env.HTTP_PROXY='';
const KEY='5c4da48f09d20c88e18e51c252b65416';
async function raw(url){const r=await fetch(url);return r.json();}
const tests=[
 ['geo 黄果树/安顺',`https://restapi.amap.com/v3/geocode/geo?key=${KEY}&address=${encodeURIComponent('黄果树瀑布')}&city=${encodeURIComponent('安顺')}`],
 ['text 黄果树/安顺',`https://restapi.amap.com/v3/place/text?key=${KEY}&keywords=${encodeURIComponent('黄果树瀑布')}&city=${encodeURIComponent('安顺')}&offset=5`],
 ['text 梵净山/铜仁',`https://restapi.amap.com/v3/place/text?key=${KEY}&keywords=${encodeURIComponent('梵净山')}&city=${encodeURIComponent('铜仁')}&offset=5`],
 ['text 西江千户苗寨/黔东南',`https://restapi.amap.com/v3/place/text?key=${KEY}&keywords=${encodeURIComponent('西江千户苗寨')}&city=${encodeURIComponent('黔东南苗族侗族自治州')}&offset=5`],
];
for(const [label,url] of tests){
  const d=await raw(url);
  console.log('===',label,'status=',d.status);
  if(d.geocodes&&d.geocodes.length) console.log('  geo:',d.geocodes[0].formatted_address,d.geocodes[0].location);
  if(d.pois&&d.pois.length){for(const p of d.pois.slice(0,3)) console.log('  poi:',p.name,'|',p.location,'|',p.pname,p.cityname,p.adname,'|',p.type);}
  if(!d.geocodes&&!d.pois) console.log('  raw:',JSON.stringify(d).slice(0,200));
}
