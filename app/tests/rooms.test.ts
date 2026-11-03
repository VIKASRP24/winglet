import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoomEvents, mentionQuery, recipients, roomLine, type RoomEvent, type RoomMember } from '../src/features/rooms/model.ts';
import * as roomModel from '../src/features/rooms/model.ts';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const members: RoomMember[] = [
  { member_id:'default',profile:'default',handle:'main',display_name:'Main' },
  { member_id:'ops',profile:'ops',handle:'ops',display_name:'Operations' },
];
test('room text starts no turn without an explicit known recipient', () => {
  assert.deepEqual(recipients('ordinary text and @unknown',members),[]);
  assert.deepEqual(recipients('@OPS @ops please inspect',members).map(x=>x.profile),['ops']);
  assert.equal(recipients('@all please review',members).length,2);
  assert.equal(mentionQuery('please ask @op'),'op');
  assert.equal(mentionQuery('please ask @ops later'),null);
});
test('room replay deduplicates by epoch identity and preserves historical order', () => {
  const event=(id:string,epoch:number,seq:number): RoomEvent => ({id,epoch,seq,kind:'message.user',actor:{kind:'user',id:'u'},payload:{text:id},created_at:1});
  const old=event('0:1',0,1),newer=event('1:1',1,1);
  assert.deepEqual(mergeRoomEvents([newer],[old,newer,old]).map(x=>x.id),['0:1','1:1']);
});
test('project room capability requires the explicit flag, including on old servers', () => {
  const supported = (roomModel as any).projectRoomsSupported;
  assert.equal(supported({ projects: true, rooms: true }), false);
  assert.equal(supported({ projects: true, rooms: true, project_rooms: true }), true);
  assert.equal(supported({ project_rooms: true, projects: true }), false);
});

test('a stale, archived or private project cannot be used for room creation', () => {
  const allowed=(roomModel as any).canCreateRoomInProject;
  const flags={rooms:true,projects:true,project_rooms:true};
  assert.equal(allowed({id:'p',private:false,archived:false},flags),true);
  assert.equal(allowed(undefined,flags),false);
  assert.equal(allowed({id:'p',private:true,archived:false},flags),false);
  assert.equal(allowed({id:'p',private:false,archived:true},flags),false);
  assert.equal(allowed({id:'p',private:false,archived:false},{rooms:true,projects:true}),false);
});

test('room project moves include source and target revisions and preserve room identity', () => {
  const build = (roomModel as any).projectRoomMoveBody;
  assert.deepEqual(build({ id:'old', revision:2 }, { id:'new', revision:5 }, 'op-1'),
    { project_id:'new', revision:5, from_project_id:'old', from_revision:2, client_id:'op-1' });
  assert.deepEqual(build({ id:'old', revision:2 }, null, 'op-2'),
    { project_id:null, from_project_id:'old', from_revision:2, client_id:'op-2' });
});

test('project room API reads and signs moves, including cross-bot source and removal', async () => {
  const calls: any[] = []; const exports: any = {};
  const source = readFileSync(new URL('../src/features/rooms/projectRoomsApi.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports, require:(id: string)=>id==='./model' ? roomModel : {
      api:async (...args: any[])=>{calls.push(['read',...args]); return {rooms:[]};},
      signedApi:async (...args: any[])=>{calls.push(['signed',...args]); return {moved:true};},
    },
  });
  const server={id:'bot'};
  await exports.loadProjectRooms(server);
  await exports.moveProjectRoom(server,'room/1',{project_id:'source',project_revision:3,project_bot:'other'}, {id:'target',revision:7}, 'op-1');
  await exports.moveProjectRoom(server,'room/1',{project_id:'target',project_revision:8},null,'op-2');
  await exports.createProjectRoom(server,{title:'Team',bots:['default','ops'],operation_id:'room-op',project_id:'target',revision:7});
  assert.equal(calls[0][2],'/api/project-rooms');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),['signed',server,'POST','/api/project-rooms/room%2F1',
    {project_id:'target',revision:7,from_project_id:'source',from_revision:3,client_id:'op-1'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2][4])),{project_id:null,from_project_id:'target',from_revision:8,client_id:'op-2'});
  assert.deepEqual(JSON.parse(JSON.stringify(calls[3])),['signed',server,'POST','/api/rooms',
    {title:'Team',bots:['default','ops'],operation_id:'room-op',project_id:'target',revision:7}]);
});

test('room project picker refuses a rapid duplicate move while the first request is pending', async () => {
  let cursor=0, finish: (()=>void) | undefined; const hooks:any[]=[]; const effects:(()=>void)[]=[]; const calls:any[]=[];
  const server={id:'gateway',bot:{title:'Main'}};
  const project={id:'p',name:'Work',revision:1,private:false,archived:false};
  const room={id:'r',members:[{profile:'default'}]};
  const state={servers:[server],network:true,runtime:{gateway:{status:'online'}}};
  const useApp=Object.assign((selector:any)=>selector(state),{getState:()=>({...state,toast:()=>{}})});
  const fallback:any=new Proxy(function(){},{get:()=>fallback,apply:()=>fallback});
  const jsx=(type:any,props:any)=>({type,props});
  const modules:any={react:{
    useState:(initial:any)=>{const i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],(v:any)=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},
    useRef:(initial:any)=>{const i=cursor++;return hooks[i]??={current:initial};},
    useEffect:(fn:any)=>{cursor++; if(!effects.length && !hooks.effectRan) effects.push(()=>{hooks.effectRan=true;fn();});},
  },'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{ScrollView:'ScrollView',Text:'Text',View:'View'},
  '../../components/Sheet':{Sheet:'Sheet'},'../../components/ui':{Button:'Button',ListGroup:'ListGroup',Tap:'Tap'},
  '../../lib/store':{useApp},'../../lib/themeContext':{makeStyles:()=>()=>fallback,useTheme:()=>fallback},
  './projectRoomsApi':{loadProjectRooms:async()=>({rooms:[{id:'r',project_id:'old',project_revision:3,project_bot:'other'}]}),loadRoomProjects:async()=>({projects:{projects:[project]}}),
    moveProjectRoom:async (...args:any[])=>{calls.push(args);await new Promise<void>(resolve=>{finish=resolve;});}},
  };
  const exports:any={};const source=readFileSync(new URL('../src/features/rooms/RoomProjectPicker.tsx',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(id:string)=>modules[id]??fallback});
  const render=()=>{cursor=0;const tree=exports.RoomProjectPicker({server,room,onClose:()=>{}});while(effects.length)effects.shift()!();return tree;};
  const nodes=(node:any):any[]=>Array.isArray(node)?node.flatMap(nodes):!node||typeof node!=='object'?[]:[node,...nodes(node.props?.children)];
  render();for(let i=0;i<10;i++)await Promise.resolve();
  const rendered=render();
  assert.ok(nodes(rendered).some(x=>x.props?.children==='Remove from project'));
  const choice=nodes(rendered).find(x=>x.type==='Tap' && x.props.accessibilityState?.checked===false && nodes(x).some((n:any)=>n.props?.children==='Work'));
  assert.ok(choice); choice.props.onPress();choice.props.onPress();
  assert.equal(calls.length,1); finish?.();
  for(let i=0;i<5;i++)await Promise.resolve();
  state.network=false;
  choice.props.onPress();
  assert.equal(calls.length,1,'an offline transition must not send using a stale callback');
});

test('rapid create taps issue only one room creation', async () => {
  let cursor=0, finish: (()=>void) | undefined; const hooks:any[]=[]; const calls:any[]=[];
  const server={id:'gateway',bot:{title:'Main'}}; const state={network:true,runtime:{gateway:{status:'online',me:{role:'owner'},info:{features:{rooms:true,projects:true,project_rooms:true}},projects:{projects:[{id:'p',private:false,archived:false,revision:1}]}}}};
  const useApp=Object.assign((selector:any)=>selector(state),{getState:()=>({...state,toast:()=>{}})});
  const fallback:any=new Proxy(function(){},{get:()=>fallback,apply:()=>fallback}); const jsx=(type:any,props:any)=>({type,props});
  const modules:any={react:{useState:(initial:any)=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return [hooks[i],(v:any)=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},useRef:(initial:any)=>{const i=cursor++;return hooks[i]??={current:initial};},useEffect:()=>{cursor++;}},
    'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{ScrollView:'ScrollView',Text:'Text',View:'View',useWindowDimensions:()=>({height:800})},
    '../../components/Sheet':{Sheet:'Sheet'},'../../components/ui':{Button:'Button',Field:'Field',SectionHeader:'SectionHeader',Tap:'Tap'},
    '../../lib/store':{useApp,isOwner:()=>true},'../../lib/themeContext':{makeStyles:()=>()=>fallback,useTheme:()=>fallback},
    './model':roomModel,'./projectRoomsApi':{createProjectRoom:async (...args:any[])=>{calls.push(args);await new Promise<void>(resolve=>{finish=resolve;});throw new Error('Connection lost');}},
  };
  const exports:any={};const source=readFileSync(new URL('../src/features/rooms/RoomsScreen.tsx',import.meta.url),'utf8')+'\nexport { RoomManage };';
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(id:string)=>modules[id]??fallback});
  const render=()=>{cursor=0;return exports.RoomManage({server,bots:[{name:'default',title:'Main',served:true},{name:'ops',title:'Ops',served:true}],projectContext:{server,project:{id:'p',name:'Work',revision:1}},onClose:()=>{},onSaved:()=>{}});};
  const nodes=(node:any):any[]=>Array.isArray(node)?node.flatMap(nodes):!node||typeof node!=='object'?[]:[node,...nodes(node.props?.children)];
  let tree=render();nodes(tree).find(x=>x.type==='Field').props.onChangeText('Team');
  nodes(tree).find(x=>x.type==='Tap' && nodes(x).some((n:any)=>n.props?.children?.[0]==='Ops')).props.onPress();
  tree=render();const button=nodes(tree).find(x=>x.type==='Button' && x.props.title==='Create room');
  assert.equal(button.props.disabled,false);button.props.onPress();button.props.onPress();assert.equal(calls.length,1);finish?.();
  for(let i=0;i<5;i++)await Promise.resolve();
  state.runtime.gateway.projects.projects[0].revision=2;
  nodes(render()).find(x=>x.type==='Button' && x.props.title==='Create room').props.onPress();
  assert.equal(calls.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])),JSON.parse(JSON.stringify(calls[0][1])), 'an ambiguous retry must reuse the exact request');
  finish?.();for(let i=0;i<5;i++)await Promise.resolve();
  state.runtime.gateway.projects.projects[0].archived=true;
  nodes(render()).find(x=>x.type==='Button' && x.props.title==='Create room').props.onPress();
  assert.equal(calls.length,2, 'an archived project must not create an unfiled room');
});

test('room failures and bounded discussions remain visible without invented success', () => {
  const event={kind:'turn.failed',payload:{error:'Bot unavailable'}} as RoomEvent;
  assert.match(roomLine(event)!,/Bot unavailable/);
  assert.equal(roomLine({...event,kind:'room.activity',payload:{status:'settled'}}),null);
  assert.match(roomLine({...event,kind:'room.activity',payload:{status:'bounded'}})!,/turn limit/);
});
