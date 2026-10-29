import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Sheet } from '../../components/Sheet';
import { Button, ListGroup, Tap } from '../../components/ui';
import { useApp } from '../../lib/store';
import { makeStyles, useTheme } from '../../lib/themeContext';
import type { Project, Server } from '../../lib/types';
import type { ProjectRoom, Room } from './model';
import { loadProjectRooms, loadRoomProjects, moveProjectRoom } from './projectRoomsApi';

type Choice = {server: Server; project: Project};
export function RoomProjectPicker({server, room, onClose}: {server:Server; room:Room; onClose:()=>void}) {
  const s=useStyles(); const t=useTheme();
  const servers=useApp(st=>st.servers);
  const online=useApp(st=>st.network && st.runtime[server.id]?.status==='online');
  const [choices,setChoices]=useState<Choice[]>([]); const [current,setCurrent]=useState<ProjectRoom>();
  const [error,setError]=useState(''); const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false); const [version,setVersion]=useState(0);
  const pending=useRef<{key:string;id:string}|null>(null);
  const inFlight=useRef(false);
  const roster=room.members.map(m=>m.profile).sort().join('\u0000');
  useEffect(()=>{
    if(!online) {setLoading(false);setError('Connect to move this room.');return;}
    let live=true; setLoading(true); setError('');
    const bots=servers.filter(bot=>(bot.parent??bot.id)===server.id && room.members.some(m=>m.profile===(bot.profile??'default')));
    Promise.all([loadProjectRooms(server), ...bots.map(bot=>loadRoomProjects(bot))]).then(([links,...snapshots])=>{
      if(!live)return;
      setCurrent(links.rooms.find(link=>link.id===room.id));
      setChoices(snapshots.flatMap((snapshot,i)=>snapshot.projects.projects.filter(p=>!p.private&&!p.archived).map(project=>({server:bots[i],project}))));
    }).catch(e=>{if(live)setError((e as Error).message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[server,room.id,roster,servers,online,version]);
  const move=async(choice:Choice|null)=>{
    if(inFlight.current||busy||loading||!online||!useApp.getState().network)return;
    if((current?.project_id??null)===(choice?.project.id??null)){onClose();return;}
    const targetServer=choice?.server ?? servers.find(bot=>(bot.parent??bot.id)===server.id && (bot.profile??'default')===(current?.project_bot||'default')) ?? server;
    const key=JSON.stringify([current?.project_id,current?.project_revision,choice?.project.id,choice?.project.revision]);
    if(!pending.current||pending.current.key!==key)pending.current={key,id:`project-room-${Date.now()}-${Math.random().toString(36).slice(2)}`};
    inFlight.current=true;setBusy(true);setError('');
    try { await moveProjectRoom(targetServer,room.id,current,choice?.project??null,pending.current.id); pending.current=null;
      useApp.getState().toast({serverId:server.id,title:choice?'Room moved':'Room removed from project',body:'The room and its messages are unchanged.'}); onClose();
    } catch(e) { setError((e as Error).message); if ((e as {status?:number}).status===409) pending.current=null; }
    finally {inFlight.current=false;setBusy(false);}
  };
  return <Sheet visible title="Move to project" onClose={onClose}><View style={s.content}>
    <Text style={s.note}>A room can be filed in one shared project belonging to a participating bot.</Text>
    {error?<Text style={s.error}>{error}</Text>:null}
    {loading?<Text style={s.note}>Loading projects…</Text>:null}
    {!loading&&!error?<ScrollView style={{maxHeight:360}}><ListGroup>
      <Tap style={s.row} disabled={busy} accessibilityRole="radio" accessibilityState={{checked:!current}} onPress={()=>void move(null)}><Text style={s.title}>{current?'Remove from project':'No project'}</Text><Text style={s.note}>{!current?'Current':''}</Text></Tap>
      {choices.map(choice=><Tap key={`${choice.server.id}:${choice.project.id}`} style={s.row} disabled={busy} accessibilityRole="radio" accessibilityState={{checked:current?.project_id===choice.project.id}} onPress={()=>void move(choice)}><View style={{flex:1}}><Text style={s.title}>{choice.project.name}</Text><Text style={s.note}>{choice.server.bot.title}</Text></View><Text style={{color:t.colors.accent}}>{current?.project_id===choice.project.id?'Current':''}</Text></Tap>)}
    </ListGroup></ScrollView>:null}
    {error&&!loading&&online?<Button title="Reload projects" variant="secondary" onPress={()=>setVersion(v=>v+1)}/>:null}
  </View></Sheet>;
}
const useStyles=makeStyles(t=>({content:{gap:12,paddingBottom:t.space.lg},row:{minHeight:56,padding:14,flexDirection:'row',alignItems:'center',gap:10},title:{...t.type.body,color:t.colors.text,flexShrink:1},note:{...t.type.caption,color:t.colors.textSecondary},error:{...t.type.callout,color:t.colors.danger}}));
