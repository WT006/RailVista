const R = 6371;
function hav(lng1, lat1, lng2, lat2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1*Math.PI)/180) * Math.cos((lat2*Math.PI)/180) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function p(name, a, b, f) {
  const d = hav(...a, ...b);
  console.log(`${name}: ${d.toFixed(1)}km × ${f} = ${Math.round(d*f)}km`);
}
console.log('--- R1 ---');
const yining=[81.32,43.92], sailimu=[81.2,44.58], nalati=[84.02,43.32], kalajun=[82.9,43.12], zhaosu=[81.13,43.15];
p('伊宁→赛里木湖', yining, sailimu, 1.45);
p('赛里木湖→伊宁', sailimu, yining, 1.45);
p('伊宁→那拉提', yining, nalati, 1.28);
p('那拉提→喀拉峻', nalati, kalajun, 1.35);
p('喀拉峻→昭苏', kalajun, zhaosu, 1.35);
p('昭苏→伊宁', zhaosu, yining, 1.30);
console.log('R1 total =', 107+107+291+126+Math.round(hav(...kalajun,...zhaosu)*1.35)+Math.round(hav(...zhaosu,...yining)*1.3));

console.log('\n--- R2 ---');
const altay=[88.14,47.85], burqin=[86.87,47.7], jiadengyu=[86.98,48.03], kanas=[86.98,48.75], hemu=[87.45,48.57], wucaitan=[86.99,48.2];
p('阿勒泰市→布尔津', altay, burqin, 1.25);
p('布尔津→贾登峪', burqin, jiadengyu, 1.40);
p('贾登峪→喀纳斯', jiadengyu, kanas, 1.20);
p('喀纳斯→贾登峪', kanas, jiadengyu, 1.20);
p('贾登峪→禾木', jiadengyu, hemu, 1.35);
p('禾木→贾登峪', hemu, jiadengyu, 1.35);
p('禾木→五彩滩', hemu, wucaitan, 1.35);
p('五彩滩→布尔津', wucaitan, burqin, 1.40);
p('布尔津→阿勒泰市', burqin, altay, 1.25);
const R2 = [Math.round(hav(...altay,...burqin)*1.25), Math.round(hav(...burqin,...jiadengyu)*1.4), Math.round(hav(...jiadengyu,...kanas)*1.2), Math.round(hav(...jiadengyu,...hemu)*1.35), Math.round(hav(...hemu,...wucaitan)*1.35)+Math.round(hav(...wucaitan,...burqin)*1.4), Math.round(hav(...burqin,...altay)*1.25)];
console.log('R2 Σ =', R2.reduce((a,b)=>a+b,0), R2);

console.log('\n--- R3 ---');
const kashgar=[75.99,39.47], tash=[75.23,37.77], karakul=[75.15,38.6], tashiman=[75.3,37.85], yingjisha=[76.17,38.93];
p('喀什→塔县', kashgar, tash, 1.30);
p('塔县→喀拉库勒湖', tash, karakul, 1.20);
p('喀拉库勒湖→塔县', karakul, tash, 1.20);
p('塔县→塔合曼', tash, tashiman, 1.40);
p('塔合曼→塔县', tashiman, tash, 1.40);
p('喀什→英吉沙', kashgar, yingjisha, 1.20);
p('英吉沙→喀什', yingjisha, kashgar, 1.20);
const s1=Math.round(hav(...kashgar,...tash)*1.3);
const s2=Math.round(hav(...tash,...karakul)*1.2)*2;
const s3=Math.round(hav(...tash,...tashiman)*1.4)*2 + Math.round(hav(...tash,...kashgar)*1.3);
const s4=Math.round(hav(...kashgar,...yingjisha)*1.2)*2;
console.log('R3:', s1, s2, s3, s4, 'Σ =', s1+s2+s3+s4);
