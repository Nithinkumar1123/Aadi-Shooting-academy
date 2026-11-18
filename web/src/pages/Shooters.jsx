import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Plus, Search, UserRound, X, Download, RefreshCw, Archive, RotateCcw, Trash2, Check, UserMinus, Clock3, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

function makeCode(){const bytes=crypto.getRandomValues(new Uint8Array(32));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');}

export default function Shooters(){
 const [shooters,setShooters]=useState([]); const [exitRequests,setExitRequests]=useState([]); const [search,setSearch]=useState(''); const [show,setShow]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [form,setForm]=useState({full_name:'',phone:'',email:'',date_of_birth:'',guardian_name:'',guardian_phone:'',discipline:'10m Air Rifle',status:'active'}); const [card,setCard]=useState(null); const [view,setView]=useState('active'); const [actionId,setActionId]=useState(null); const [reviewNotes,setReviewNotes]=useState({}); const [record,setRecord]=useState(null); const [recordLoading,setRecordLoading]=useState(false);
 async function load(){
   const [{data,error},{data:reqData,error:reqError}] = await Promise.all([
     supabase.from('shooters').select('*').eq('is_guest',false).order('created_at',{ascending:false}),
     supabase.from('shooter_exit_requests').select('*, shooters(full_name, shooter_code, email)').order('requested_at',{ascending:false})
   ]);
   if(error) setError(error.message); else setShooters(data||[]);
   if(reqError) setError(reqError.message); else setExitRequests(reqData||[]);
 }
 useEffect(()=>{load()},[]);
 async function openRecord(shooter){
   setRecordLoading(true); setError('');
   const [a,s,f,r] = await Promise.all([
     supabase.from('attendance').select('id,checked_in_at,checked_out_at,notes').eq('shooter_id',shooter.id).order('checked_in_at',{ascending:false}),
     supabase.from('shooting_scores').select('id,session_date,event_name,shots,score,max_score,notes,created_at').eq('shooter_id',shooter.id).order('session_date',{ascending:false}),
     supabase.from('fees').select('id,title,amount,due_date,status,paid_at,payment_method,payment_reference,created_at').eq('shooter_id',shooter.id).order('due_date',{ascending:false}),
     supabase.from('shooter_exit_requests').select('id,reason,status,requested_at,reviewed_at,review_note').eq('shooter_id',shooter.id).order('requested_at',{ascending:false})
   ]);
   const firstError=[a.error,s.error,f.error,r.error].find(Boolean);
   if(firstError) setError(firstError.message);
   setRecord({shooter,attendance:a.data||[],scores:s.data||[],fees:f.data||[],exitRequests:r.data||[]});
   setRecordLoading(false);
 }
 async function register(e){e.preventDefault();setBusy(true);setError('');setNotice('');const code='AADI-'+Date.now().toString().slice(-7);const {data,error}=await supabase.from('shooters').insert({...form,shooter_code:code}).select().single();if(error){setError(error.message);setBusy(false);return;}try{const token=makeCode();const {error:qrErr}=await supabase.rpc('issue_shooter_qr',{p_shooter_id:data.id,p_token:token});if(qrErr)throw qrErr;const image=await QRCode.toDataURL(token,{width:420,margin:2,errorCorrectionLevel:'H'});setCard({shooter:data,token,image});setNotice('Shooter registered. Save or print the QR card now; the secret QR token is not shown again.');setForm({full_name:'',phone:'',email:'',date_of_birth:'',guardian_name:'',guardian_phone:'',discipline:'10m Air Rifle',status:'active'});setShow(false);await load();}catch(err){setError('Shooter was created, but QR issuance failed: '+err.message)}setBusy(false)}
 async function regenerate(s){setError('');try{const token=makeCode();const {error}=await supabase.rpc('issue_shooter_qr',{p_shooter_id:s.id,p_token:token});if(error)throw error;const image=await QRCode.toDataURL(token,{width:420,margin:2,errorCorrectionLevel:'H'});setCard({shooter:s,token,image});setNotice('New QR issued. The previous QR has been deactivated.');}catch(e){setError(e.message)}}
 async function reviewRequest(id, approve){
   setActionId(id); setError('');
   const {error} = await supabase.rpc('review_shooter_exit_request',{p_request_id:id,p_approve:approve,p_note:(reviewNotes[id]||'').trim()||null});
   if(error) setError(error.message); else { setNotice(approve ? 'Leave request approved. The shooter has been moved to Past Shooters.' : 'Leave request rejected. The shooter remains active.'); setReviewNotes(n=>{const c={...n};delete c[id];return c;}); await load(); }
   setActionId(null);
 }
 async function restore(s){
   if(!window.confirm(`Restore ${s.full_name} to active membership?`)) return;
   setActionId(s.id); setError('');
   const {error}=await supabase.rpc('restore_past_shooter',{p_shooter_id:s.id});
   if(error) setError(error.message); else {setNotice(`${s.full_name} is active again.`); await load();}
   setActionId(null);
 }
 async function permanentlyDelete(s){
   const ok=window.confirm(`Permanently delete ${s.full_name} and their stored academy records? This cannot be undone.`);
   if(!ok) return;
   setActionId(s.id); setError('');
   const {error}=await supabase.rpc('permanently_delete_shooter',{p_shooter_id:s.id});
   if(error) setError(error.message); else {setNotice(`${s.full_name} was permanently deleted.`); await load();}
   setActionId(null);
 }
 const pendingRequests=exitRequests.filter(r=>r.status==='pending');
 const filtered=useMemo(()=>shooters.filter(s=>{
   const q=(s.full_name+' '+s.shooter_code+' '+(s.phone||'')+' '+(s.email||'')).toLowerCase();
   const matches=q.includes(search.toLowerCase());
   const isPast=view==='past' ? s.status==='inactive' && !!s.archived_at : !(s.status==='inactive' && s.archived_at);
   return matches && isPast;
 }),[shooters,search,view]);
 return <>
 <div className="page-heading"><div><p className="eyebrow">MEMBER DIRECTORY</p><h1>Shooters</h1><p className="muted">Manage active members, leave requests and your Past Shooters archive.</p></div><button className="primary" onClick={()=>setShow(true)}><Plus size={17}/> Register shooter</button></div>
 {error&&<div className="alert error">{error}</div>}{notice&&<div className="alert success">{notice}</div>}
 <section className="panel shooter-management-panel">
   <div className="member-view-tabs"><button className={view==='active'?'active':''} onClick={()=>setView('active')}><ShieldCheck size={15}/> Active & requests <span>{shooters.filter(s=>!(s.status==='inactive'&&s.archived_at)).length}</span></button><button className={view==='past'?'active':''} onClick={()=>setView('past')}><Archive size={15}/> Past Shooters <span>{shooters.filter(s=>s.status==='inactive'&&s.archived_at).length}</span></button></div>
   {view==='active' && pendingRequests.length>0 && <div className="exit-request-panel"><div className="exit-request-head"><div><p className="eyebrow">MEMBERSHIP REQUESTS</p><h2>Leave requests <span className="count">{pendingRequests.length}</span></h2><p className="muted">Review requests before moving a shooter to Past Shooters.</p></div><span className="pending-pill"><Clock3 size={14}/> Needs review</span></div>
     <div className="exit-request-list">{pendingRequests.map(r=><article className="exit-request-card" key={r.id}>
       <div className="exit-card-top">
         <div className="person-cell"><span className="person-avatar"><UserMinus size={18}/></span><span><b>{r.shooters?.full_name || 'Shooter'}</b><small>{r.shooters?.shooter_code || '—'} · {r.shooters?.email || 'No email'}</small></span></div>
         <time className="exit-time"><Clock3 size={14}/> {new Date(r.requested_at).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time>
       </div>
       <div className="exit-reason"><small>Reason for leaving</small><p>{r.reason}</p></div>
       <div className="exit-review">
         <label htmlFor={`note-${r.id}`}>Review note <em>(optional)</em></label>
         <div className="exit-review-row">
           <input id={`note-${r.id}`} value={reviewNotes[r.id]||''} onChange={e=>setReviewNotes(n=>({...n,[r.id]:e.target.value}))} placeholder="Add a note for the shooter or your records"/>
           <div className="exit-actions">
             <button className="small-outline no" disabled={actionId===r.id} onClick={()=>reviewRequest(r.id,false)}><X size={16}/> Reject</button>
             <button className="small-outline ok" disabled={actionId===r.id} onClick={()=>reviewRequest(r.id,true)}><Check size={16}/> {actionId===r.id?'Working…':'Approve & archive'}</button>
           </div>
         </div>
       </div>
     </article>)}</div>
   </div>}
   <div className="list-toolbar"><div><h2>{view==='past'?'Past Shooters':'All current shooters'} <span className="count">{filtered.length}</span></h2><p className="muted">{view==='past'?'Archived member records retained for academy history.':'Current member profiles and membership details.'}</p></div><div className="searchbox"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, ID or phone"/></div></div>
   <div className="table-wrap"><table><thead><tr><th>Shooter</th><th>Membership ID</th><th>Phone</th><th>Discipline</th><th>Status</th><th>{view==='past'?'Archive details':'QR / actions'}</th></tr></thead><tbody>{filtered.map(s=><tr key={s.id}><td><div className="person-cell"><span className="person-avatar">{view==='past'?<Archive size={17}/>:<UserRound size={17}/>}</span><span><b>{s.full_name}</b><small>{s.email||'No email added'}</small></span></div></td><td>{s.shooter_code}</td><td>{s.phone||'—'}</td><td>{s.discipline||'—'}</td><td><span className={`badge ${s.approval_status==='pending'?'amber':s.approval_status==='rejected'?'red':s.status==='active'?'green':'gray'}`}>{s.approval_status==='approved'?s.status:s.approval_status}</span></td><td>{view==='past'?<div className="past-actions"><small>{s.archive_reason || 'Left academy'}{s.archived_at ? ` · ${new Date(s.archived_at).toLocaleDateString('en-IN')}` : ''}</small><div><button className="small-outline" onClick={()=>openRecord(s)}><Archive size={14}/> View record</button><button className="small-outline ok" disabled={actionId===s.id} onClick={()=>restore(s)}><RotateCcw size={14}/> Restore</button><button className="small-outline no" disabled={actionId===s.id} onClick={()=>permanentlyDelete(s)}><Trash2 size={14}/> Delete permanently</button></div></div>:<button className="small-outline" disabled={s.approval_status!=='approved'} title={s.approval_status!=='approved'?'Approve this shooter first':''} onClick={()=>regenerate(s)}><RefreshCw size={14}/> Issue QR</button>}</td></tr>)}</tbody></table>{filtered.length===0&&<div className="empty-inline">{view==='past'?<Archive/>:<UserRound/>}<p>{view==='past'?'No past shooters yet.':'No shooters found.'}</p><span>{view==='past'?'Approved leave requests will appear here after an admin archives a shooter.':'Register your first shooter to get started.'}</span></div>}</div>
 </section>
 {show&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><h2>Register shooter</h2><p className="muted">Add the shooter's basic details.</p></div><button className="icon-btn" onClick={()=>setShow(false)}><X/></button></div><form onSubmit={register} className="form-grid"><label className="span-2">Full name *<input required value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></label><label>Phone number<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Date of birth<input type="date" value={form.date_of_birth} onChange={e=>setForm({...form,date_of_birth:e.target.value})}/></label><label>Discipline<select value={form.discipline} onChange={e=>setForm({...form,discipline:e.target.value})}><option>10m Air Rifle</option><option>10m Air Pistol</option><option>50m Rifle</option><option>Other</option></select></label><label>Parent / guardian name<input value={form.guardian_name} onChange={e=>setForm({...form,guardian_name:e.target.value})}/></label><label>Guardian phone<input value={form.guardian_phone} onChange={e=>setForm({...form,guardian_phone:e.target.value})}/></label><div className="modal-actions span-2"><button type="button" className="secondary" onClick={()=>setShow(false)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Register & generate QR'}</button></div></form></div></div>}
 {record&&<div className="modal-backdrop"><div className="modal past-record-modal"><div className="modal-head"><div><p className="eyebrow">PAST SHOOTER RECORD</p><h2>{record.shooter.full_name}</h2><p className="muted">{record.shooter.shooter_code} · {record.shooter.email||'No email'}</p></div><button className="icon-btn" onClick={()=>setRecord(null)}><X/></button></div>{recordLoading?<div className="empty-inline"><Clock3/><p>Loading record…</p></div>:<div className="past-record-body"><div className="record-summary"><div><small>Status</small><b>Past Shooter</b></div><div><small>Joined</small><b>{record.shooter.created_at?new Date(record.shooter.created_at).toLocaleDateString('en-IN'):'—'}</b></div><div><small>Archived</small><b>{record.shooter.archived_at?new Date(record.shooter.archived_at).toLocaleDateString('en-IN'):'—'}</b></div><div><small>Reason</small><b>{record.shooter.archive_reason||'—'}</b></div></div><div className="record-grid"><section><h3>Attendance <span>{record.attendance.length}</span></h3>{record.attendance.slice(0,8).map(x=><div className="record-row" key={x.id}><span>{new Date(x.checked_in_at).toLocaleDateString('en-IN')}</span><span>{new Date(x.checked_in_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} → {x.checked_out_at?new Date(x.checked_out_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'Open'}</span></div>)}{!record.attendance.length&&<p className="muted">No attendance history.</p>}</section><section><h3>Scores <span>{record.scores.length}</span></h3>{record.scores.slice(0,8).map(x=><div className="record-row" key={x.id}><span>{x.event_name}</span><b>{x.score}/{x.max_score}</b></div>)}{!record.scores.length&&<p className="muted">No score history.</p>}</section><section><h3>Fees <span>{record.fees.length}</span></h3>{record.fees.slice(0,8).map(x=><div className="record-row" key={x.id}><span>{x.title}</span><b className={x.status==='paid'?'record-paid':'record-pending'}>{x.status==='paid'?'Paid':'Pending'} · ₹{Number(x.amount).toLocaleString('en-IN')}</b></div>)}{!record.fees.length&&<p className="muted">No fee history.</p>}</section><section><h3>Leave requests <span>{record.exitRequests.length}</span></h3>{record.exitRequests.map(x=><div className="record-row record-row-stack" key={x.id}><span><b>{x.status}</b><small>{new Date(x.requested_at).toLocaleString('en-IN')}</small></span><span>{x.reason}</span></div>)}{!record.exitRequests.length&&<p className="muted">No leave requests.</p>}</section></div></div>}<div className="modal-actions"><button className="secondary" onClick={()=>setRecord(null)}>Close</button></div></div></div>}
 {card&&<div className="modal-backdrop"><div className="modal qr-modal"><div className="modal-head"><div><h2>Shooter QR card</h2><p className="muted">{card.shooter.full_name} · {card.shooter.shooter_code}</p></div><button className="icon-btn" onClick={()=>setCard(null)}><X/></button></div><div className="print-card"><div className="print-brand">AADI RIFLE SHOOTING</div><img src={card.image} alt="Shooter QR code"/><h3>{card.shooter.full_name}</h3><p>{card.shooter.shooter_code}</p><small>ACADEMY MEMBERSHIP · SHOW AT CHECK-IN</small></div><p className="tiny muted">Keep this QR private. If the card is lost, issue a new QR to deactivate the previous one.</p><button className="primary full" onClick={()=>{const a=document.createElement('a');a.href=card.image;a.download=`${card.shooter.shooter_code}-qr.png`;a.click()}}><Download size={16}/> Download QR card</button><button className="secondary full" onClick={()=>window.print()}>Print card</button></div></div>}
 </>;
}
