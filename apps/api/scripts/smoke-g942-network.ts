import { matchCorridorNetwork } from '../src/services/corridorNetwork.ts';
import { buildRailwayMetrics, projectToRailway } from '@railvista/shared';

const stops = [
  { name: '广州南', lng: 113.2640375, lat: 22.9914143 },
  { name: '韶关', lng: 113.5089582, lat: 24.753512 },
  { name: '郴州西', lng: 112.963555, lat: 25.725446 },
  { name: '衡阳东', lng: 112.705344, lat: 26.901773 },
  { name: '长沙南', lng: 113.0598811, lat: 28.1500782 },
  { name: '咸宁北', lng: 114.356702, lat: 29.945504 },
  { name: '武汉', lng: 114.419, lat: 30.6096 },
  { name: '驻马店西', lng: 113.967472, lat: 33.07347 },
  { name: '漯河西', lng: 113.961043, lat: 33.647079 },
  { name: '郑州东', lng: 113.777, lat: 34.76 },
  { name: '兰考南', lng: 114.825855, lat: 34.76866 },
  { name: '庄寨', lng: 115.1860909, lat: 35.0337718 },
  { name: '菏泽东', lng: 115.487693, lat: 35.139546 },
  { name: '嘉祥北', lng: 116.180626, lat: 35.455329 },
  { name: '济宁北', lng: 116.6082682, lat: 35.5245755 },
  { name: '曲阜东', lng: 117.064341, lat: 35.5565465 },
  { name: '泰安', lng: 117.0286667, lat: 36.1717083 },
  { name: '济南', lng: 116.9851524, lat: 36.6708478 },
  { name: '淄博', lng: 118.0503244, lat: 36.7868463 },
  { name: '潍坊', lng: 119.0915313, lat: 36.6961413 },
  { name: '胶州北', lng: 119.992475, lat: 36.424152 },
  { name: '青岛', lng: 120.3076944, lat: 36.065375 },
];

const net = matchCorridorNetwork(stops, { trainCode: 'G942' });
console.log('hit', !!net, 'ids', net?.corridorIds?.join('+') ?? 'null');
if (!net) process.exit(1);
const { path, lengthKm } = buildRailwayMetrics(net.coords);
console.log('pathKm', lengthKm.toFixed(1), 'pts', net.coords.length);
let worst = { name: '', d: 0 };
for (const s of stops) {
  const p = projectToRailway(path, lengthKm, s.lng!, s.lat!);
  console.log(`${s.name}\t${p.distKm.toFixed(2)}km`);
  if (p.distKm > worst.d) worst = { name: s.name, d: p.distKm };
}
console.log('worst', worst.name, worst.d.toFixed(2));
if (worst.d > 6) process.exit(2);
