const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../public/agenda.js'), L = require('../public/logica.js'), C = require('../public/cripto.js');
const base = {curso:{inicio:'2026-09-01',fin:'2027-06-30'},horario:{normal:'9–17',especiales:[]},ninos:[{id:'nico',nombre:'Nico'},{id:'vera',nombre:'Vera'}],semanal:[],eventos:[],tareas:[],sinCole:[{fecha:'2026-11-02',motivo:'Festivo'}]};
const entry = extra => ({id:'test-1',tipo:'evento',titulo:'Excursión',ninos:['nico'],fecha:'2026-11-03',hora:'16:00',...extra});
const validar = entries => A.validarLista(entries,['nico','vera']);
test('birthday repeats annually, never before its first occurrence',()=>{
 const D=A.aplicar(base,validar([entry({tipo:'cumple',titulo:'Ana',fecha:'2026-11-03',anual:true,ninos:['nico','vera']})]));
 assert.equal(L.itemsDe(D,'nico','2027-11-03')[0].titulo,'Cumpleaños · Ana');
 assert.equal(L.itemsDe(D,'vera','2026-11-03').length,1);
 assert.equal(L.itemsDe(D,'nico','2025-11-03').length,0);
 assert.equal(L.itemsDe(D,'nico','2027-11-04').length,0);
 assert.equal(base.eventos.length,0);
});
test('one-off events stay one-off and retain place and equipment',()=>{
 const D=A.aplicar(base,validar([entry({lugar:'Piscina',llevar:'Toalla'})]));
 assert.match(L.itemsDe(D,'nico','2026-11-03')[0].detalle,/Piscina/);
 assert.equal(L.itemsDe(D,'nico','2026-11-03')[0].llevar,'Toalla');
 assert.equal(L.itemsDe(D,'nico','2027-11-03').length,0);
});
test('weekly recurrence respects date range, selected children and school holidays',()=>{
 const e=entry({tipo:'extra',dias:[1,3],fecha:'2026-11-01',hasta:'2026-11-10',soloConCole:true});
 const D=A.aplicar(base,validar([e]));
 assert.equal(L.itemsDe(D,'nico','2026-11-02').length,0);
 assert.equal(L.itemsDe(D,'nico','2026-11-04').length,1);
 assert.equal(L.itemsDe(D,'nico','2026-11-11').length,0);
 assert.equal(L.itemsDe(D,'vera','2026-11-04').length,0);
 const libre=A.aplicar(base,validar([{...e,soloConCole:false}]));
 assert.equal(L.itemsDe(libre,'nico','2026-11-02').length,1);
});
test('tasks support optional deadlines and distinct identities for equal titles',()=>{
 const D=A.aplicar(base,validar([entry({tipo:'tarea',fecha:''}),entry({id:'test-2',tipo:'tarea'})]));
 assert.equal(D.tareas[0].limite,'');
 assert.notEqual(D.tareas[0]._personalId,D.tareas[1]._personalId);
 assert.equal(base.tareas.length,0);
});
test('invalid import data is rejected before storage',()=>{
 for(const e of [entry({ninos:[]}),entry({ninos:['desconocido']}),entry({fecha:'2026-02-30'}),entry({hora:'29:00'}),entry({tipo:'extra',dias:[]}),entry({tipo:'extra',dias:[9]}),entry({tipo:'extra',dias:[1],hasta:'2026-01-01'}),entry({titulo:''}),entry({titulo:'x'.repeat(161)})]) assert.throws(()=>validar([e]));
 assert.throws(()=>validar([entry({}),entry({})]));
 assert.throws(()=>validar({}));
});
test('encrypted backup round-trips and rejects another family code',async()=>{
 const data={formato:'kibi-anotaciones',version:1,entradas:validar([entry({})])};
 const encrypted=await C.cifrar(data,'codigo de prueba');
 assert.ok(!JSON.stringify(encrypted).includes('Excursión'));
 assert.deepEqual(await C.descifrar(encrypted,'codigo de prueba'),data);
 await assert.rejects(()=>C.descifrar(encrypted,'otro codigo'));
});
