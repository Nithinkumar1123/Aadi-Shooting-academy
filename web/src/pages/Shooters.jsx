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
     supabase.from('shooter_exit_requests').select('*, shooters(full_name, shooter_code, email, avatar_url)').order('requested_at',{ascending:false})
   ]);
   if(error) setError(error.message); else setShooters(data||[]);
   if(reqError) setError(reqError.message); else setExitRequests(reqData||[]);
 }
 useEffect(()=>{load()},[]);
 async function openRecord(shooter){
   setRecordLoading(true); setError('');
   const activeIds=shooters.filter(x=>x.status==='active' && x.approval_status==='approved').map(x=>x.id);
   const [a,s,f,r,allScores] = await Promise.all([
     supabase.from('attendance').select('id,checked_in_at,checked_out_at,notes').eq('shooter_id',shooter.id).order('checked_in_at',{ascending:false}),
     supabase.from('shooting_scores').select('id,session_date,event_name,shots,score,max_score,notes,created_at').eq('shooter_id',shooter.id).order('session_date',{ascending:false}),
     supabase.from('fees').select('id,title,amount,due_date,status,paid_at,payment_method,payment_reference,created_at').eq('shooter_id',shooter.id).order('due_date',{ascending:false}),
     supabase.from('shooter_exit_requests').select('id,reason,status,requested_at,reviewed_at,review_note').eq('shooter_id',shooter.id).order('requested_at',{ascending:false}),
     activeIds.length ? supabase.from('shooting_scores').select('shooter_id,score,max_score').in('shooter_id',activeIds) : Promise.resolve({data:[],error:null})
   ]);
   const firstError=[a.error,s.error,f.error,r.error,allScores.error].find(Boolean);
   if(firstError) setError(firstError.message);
   setRecord({shooter,attendance:a.data||[],scores:s.data||[],fees:f.data||[],exitRequests:r.data||[],comparisonScores:allScores.data||[]});
   setRecordLoading(false);
 }
 async function register(e){e.preventDefault();setBusy(true);setError('');setNotice('');const {data:id,error}=await supabase.rpc('admin_register_shooter',{p_full_name:form.full_name,p_phone:form.phone||null,p_email:form.email.trim(),p_date_of_birth:form.date_of_birth||null,p_guardian_name:form.guardian_name||null,p_guardian_phone:form.guardian_phone||null,p_discipline:form.discipline});if(error){setError(error.message);setBusy(false);return;}const {data,error:loadError}=await supabase.from('shooters').select('*').eq('id',id).single();if(loadError){setError('Shooter was registered, but the profile could not be loaded: '+loadError.message);setBusy(false);return;}try{const token=makeCode();const {error:qrErr}=await supabase.rpc('issue_shooter_qr',{p_shooter_id:data.id,p_token:token});if(qrErr)throw qrErr;const image=await QRCode.toDataURL(token,{width:420,margin:2,errorCorrectionLevel:'H'});setCard({shooter:data,token,image});setNotice('Shooter registered. Ask them to choose Create account with this email to set their password. Save or print the QR card now.');setForm({full_name:'',phone:'',email:'',date_of_birth:'',guardian_name:'',guardian_phone:'',discipline:'10m Air Rifle',status:'active'});setShow(false);await load();}catch(err){setError('Shooter was created, but QR issuance failed: '+err.message)}setBusy(false)}
 async function regenerate(s){setError('');try{const token=makeCode();const {error}=await supabase.rpc('issue_shooter_qr',{p_shooter_id:s.id,p_token:token});if(error)throw error;const image=await QRCode.toDataURL(token,{width:420,margin:2,errorCorrectionLevel:'H'});setCard({shooter:s,token,image});setNotice('New QR issued. The previous QR has been deactivated.');}catch(e){setError(e.message)}}
 async function reviewRequest(id, approve){
   setActionId(id); setError('');
   const {error} = await supabase.rpc('review_shooter_exit_request',{p_request_id:id,p_approve:approve,p_note:(reviewNotes[id]||'').trim()||null});
   if(error) setError(error.message); else { setNotice(approve ? 'Leave request approved. The shooter has been moved to Past Shooters.' : 'Leave request rejected. The shooter remains active.'); setReviewNotes(n=>{const c={...n};delete c[id];return c;}); await load(); }
   setActionId(null);
 }
 async function archiveShooter(s){
   if(!window.confirm(`Archive ${s.full_name}? Their attendance, scores and payment history will be retained. They will no longer be able to use their active membership QR.`)) return;
   setActionId(s.id); setError('');
   const {error}=await supabase.rpc('archive_shooter',{p_shooter_id:s.id,p_reason:'Archived by academy admin'});
   if(error) setError(error.message); else {setNotice(`${s.full_name} has been moved to Past Shooters. Their records have been retained.`); await load();}
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
   <div className="table-wrap"><table><thead><tr><th>Shooter</th><th>Membership ID</th><th>Phone</th><th>Discipline</th><th>Status</th><th>{view==='past'?'Archive details':'QR / actions'}</th></tr></thead><tbody>{filtered.map(s=><tr key={s.id}><td><div className="person-cell"><span className="person-avatar">{s.avatar_url?<img src={s.avatar_url} alt=""/>:view==='past'?<Archive size={17}/>:<UserRound size={17}/>}</span><span><b>{s.full_name}</b><small>{s.email||'No email added'}</small></span></div></td><td>{s.shooter_code}</td><td>{s.phone||'—'}</td><td>{s.discipline||'—'}</td><td><span className={`badge ${s.approval_status==='pending'?'amber':s.approval_status==='rejected'?'red':s.status==='active'?'green':'gray'}`}>{s.approval_status==='approved'?s.status:s.approval_status}</span></td><td>{view==='past'?<div className="past-actions"><small>{s.archive_reason || 'Left academy'}{s.archived_at ? ` · ${new Date(s.archived_at).toLocaleDateString('en-IN')}` : ''}</small><div><button className="small-outline" onClick={()=>openRecord(s)}><Archive size={14}/> View record</button><button className="small-outline ok" disabled={actionId===s.id} onClick={()=>restore(s)}><RotateCcw size={14}/> Restore</button><button className="small-outline no" disabled={actionId===s.id} onClick={()=>permanentlyDelete(s)}><Trash2 size={14}/> Delete permanently</button></div></div>:<div className="past-actions"><div><button className="small-outline" disabled={s.approval_status!=='approved'} title={s.approval_status!=='approved'?'Approve this shooter first':'View attendance, scores and fees'} onClick={()=>openRecord(s)}><UserRound size={14}/> Performance</button><button className="small-outline" disabled={s.approval_status!=='approved'} title={s.approval_status!=='approved'?'Approve this shooter first':''} onClick={()=>regenerate(s)}><RefreshCw size={14}/> Issue QR</button><button className="small-outline no" disabled={actionId===s.id || s.approval_status!=='approved'} onClick={()=>archiveShooter(s)} title="Archive this shooter and retain their records"><Archive size={14}/> Archive</button></div></div>}</td></tr>)}</tbody></table>{filtered.length===0&&<div className="empty-inline">{view==='past'?<Archive/>:<UserRound/>}<p>{view==='past'?'No past shooters yet.':'No shooters found.'}</p><span>{view==='past'?'Approved leave requests will appear here after an admin archives a shooter.':'Register your first shooter to get started.'}</span></div>}</div>
 </section>
 {show&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><h2>Register shooter</h2><p className="muted">Add the shooter's details and a unique email address for account activation.</p></div><button className="icon-btn" onClick={()=>setShow(false)}><X/></button></div><form onSubmit={register} className="form-grid"><label className="span-2">Full name *<input required value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></label><label>Phone number<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Email *<input type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/><small className="muted">The shooter will use this email to create their password and activate their login.</small></label><label>Date of birth<input type="date" value={form.date_of_birth} onChange={e=>setForm({...form,date_of_birth:e.target.value})}/></label><label>Discipline<select value={form.discipline} onChange={e=>setForm({...form,discipline:e.target.value})}><option>10m Air Rifle</option><option>10m Air Pistol</option><option>50m Rifle</option><option>Other</option></select></label><label>Parent / guardian name<input value={form.guardian_name} onChange={e=>setForm({...form,guardian_name:e.target.value})}/></label><label>Guardian phone<input value={form.guardian_phone} onChange={e=>setForm({...form,guardian_phone:e.target.value})}/></label><div className="modal-actions span-2"><button type="button" className="secondary" onClick={()=>setShow(false)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Register shooter & generate QR'}</button></div></form></div></div>}
 {record&&<ShooterPerformanceModal record={record} loading={recordLoading} onClose={()=>setRecord(null)} shooters={shooters}/> }
 {card&&<div className="modal-backdrop"><div className="modal qr-modal"><div className="modal-head"><div><h2>Shooter QR card</h2><p className="muted">{card.shooter.full_name} · {card.shooter.shooter_code}</p></div><button className="icon-btn" onClick={()=>setCard(null)}><X/></button></div><div className="print-card"><div className="print-brand">AADI RIFLE SHOOTING</div><img src={card.image} alt="Shooter QR code"/><h3>{card.shooter.full_name}</h3><p>{card.shooter.shooter_code}</p><small>ACADEMY MEMBERSHIP · SHOW AT CHECK-IN</small></div><p className="tiny muted">Keep this QR private. If the card is lost, issue a new QR to deactivate the previous one.</p><p className="tiny muted">For portal access, the shooter should choose <b>Create account</b> and use <b>{card.shooter.email}</b> to set their password. If this email already has an AADI login, they should sign in with that account or use Forgot password.</p><button className="primary full" onClick={()=>{const a=document.createElement('a');a.href=card.image;a.download=`${card.shooter.shooter_code}-qr.png`;a.click()}}><Download size={16}/> Download QR card</button><button className="secondary full" onClick={()=>window.print()}>Print card</button></div></div>}
 </>;
}


function ShooterPerformanceModal({record,loading,onClose,shooters}) {
 const {shooter,attendance,scores,fees,comparisonScores=[]}=record;
 const now=new Date();
 const monthAttendance=attendance.filter(x=>{const d=new Date(x.checked_in_at);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()}).length;
 const avgScore=scores.length?scores.reduce((n,x)=>n+(Number(x.max_score)>0?Number(x.score)/Number(x.max_score)*100:0),0)/scores.length:0;
 const paid=fees.filter(x=>x.status==='paid').reduce((n,x)=>n+Number(x.amount||0),0);
 const pending=fees.filter(x=>x.status!=='paid').reduce((n,x)=>n+Number(x.amount||0),0);
 const overdue=fees.filter(x=>x.status!=='paid'&&x.due_date&&new Date(`${x.due_date}T23:59:59`)<now).reduce((n,x)=>n+Number(x.amount||0),0);
 const benchmark=new Map();
 comparisonScores.forEach(x=>{const max=Number(x.max_score),score=Number(x.score);if(max<=0)return;const old=benchmark.get(x.shooter_id)||{sum:0,count:0};old.sum+=score/max*100;old.count++;benchmark.set(x.shooter_id,old)});
 const rankings=[...benchmark.entries()].map(([id,v])=>({id,avg:v.sum/v.count,count:v.count,name:shooters.find(x=>x.id===id)?.full_name||'Shooter',code:shooters.find(x=>x.id===id)?.shooter_code||''})).sort((a,b)=>b.avg-a.avg);
 const position=rankings.findIndex(x=>x.id===shooter.id)+1;
 const maxBar=Math.max(100,...rankings.slice(0,5).map(x=>x.avg));
 const visibleRankings=rankings.slice(0,5);
 const selectedRanking=rankings.find(x=>x.id===shooter.id);
 if(selectedRanking&&!visibleRankings.some(x=>x.id===shooter.id)) visibleRankings.push(selectedRanking);
 visibleRankings.sort((a,b)=>b.avg-a.avg);
 const money=n=>`₹${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
 const pct=n=>`${Number(n||0).toFixed(1)}%`;
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal past-record-modal performance-modal"><div className="modal-head"><div className="performance-title"><span className="performance-avatar">{shooter.avatar_url?<img src={shooter.avatar_url} alt=""/>:<UserRound size={22}/>}</span><div><p className="eyebrow">SHOOTER 360° PROFILE</p><h2>{shooter.full_name}</h2><p className="muted">{shooter.shooter_code} · {shooter.discipline||'Discipline not set'} · {shooter.email||'No email'}</p></div></div><button className="icon-btn" onClick={onClose} aria-label="Close performance profile"><X/></button></div>
 {loading?<div className="empty-inline"><Clock3/><p>Loading shooter performance…</p></div>:<div className="past-record-body performance-body">
  <div className="performance-status-row"><span className={`badge ${shooter.status==='active'?'green':'gray'}`}>{shooter.status==='active'?'Active member':'Past shooter'}</span><span className={`badge ${shooter.approval_status==='approved'?'green':'amber'}`}>{shooter.approval_status||'Status unavailable'}</span><small>Member since {shooter.created_at?new Date(shooter.created_at).toLocaleDateString('en-IN'):'—'}</small></div>
  <div className="performance-kpis">
   <article><small>Total sessions</small><strong>{attendance.length}</strong><span>{monthAttendance} this month</span></article>
   <article><small>Average score</small><strong>{scores.length?pct(avgScore):'—'}</strong><span>{scores.length} score records</span></article>
   <article><small>Fees paid</small><strong>{money(paid)}</strong><span>{fees.filter(x=>x.status==='paid').length} payments recorded</span></article>
   <article className={pending>0?'kpi-attention':''}><small>Outstanding fees</small><strong>{money(pending)}</strong><span>{overdue>0?`${money(overdue)} overdue`:'No overdue balance'}</span></article>
  </div>
  <div className="performance-columns">
   <section className="performance-section"><div className="performance-section-head"><div><h3>Attendance overview</h3><p>Recent training visits and session status</p></div><span className="count">{attendance.length}</span></div><div className="mini-stat-row"><div><b>{monthAttendance}</b><small>Visits this month</small></div><div><b>{attendance.filter(x=>!x.checked_out_at).length}</b><small>Open sessions</small></div><div><b>{attendance.filter(x=>x.checked_out_at).length}</b><small>Completed</small></div></div><div className="performance-list">{attendance.slice(0,7).map(x=><div className="record-row" key={x.id}><span><b>{new Date(x.checked_in_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</b><small>{new Date(x.checked_in_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</small></span><span className={`badge ${x.checked_out_at?'green':'amber'}`}>{x.checked_out_at?'Completed':'Checked in'}</span></div>)}{!attendance.length&&<p className="muted">No attendance records yet.</p>}</div></section>
   <section className="performance-section"><div className="performance-section-head"><div><h3>Shooting performance</h3><p>Scores converted to percentage for fair comparison</p></div><span className="count">{scores.length}</span></div>{scores.length>0&&<div className="score-highlight"><strong>{pct(avgScore)}</strong><span>Average score rate</span><small>{position?`Rank ${position} of ${rankings.length} shooters with recorded scores`:'Not ranked yet'}</small></div>}<div className="performance-list">{scores.slice(0,7).map(x=><div className="record-row" key={x.id}><span><b>{x.event_name||'Practice'}</b><small>{x.session_date?new Date(`${x.session_date}T00:00:00`).toLocaleDateString('en-IN'):'—'} · {x.shots||'—'} shots</small></span><b>{Number(x.score).toFixed(1)} / {Number(x.max_score).toFixed(1)}</b></div>)}{!scores.length&&<p className="muted">No shooting scores recorded yet.</p>}</div></section>
  </div>
  <section className="performance-section comparison-section"><div className="performance-section-head"><div><h3>Player comparison</h3><p>Top active shooters by average score percentage. Only recorded scores are included.</p></div><span className="count">{rankings.length} players</span></div>{rankings.length?<div className="comparison-list">{visibleRankings.map((x)=><div className={`comparison-row ${x.id===shooter.id?'is-selected':''}`} key={x.id}><span className="comparison-rank">{rankings.findIndex(r=>r.id===x.id)+1}</span><span className="comparison-name"><b>{x.name}{x.id===shooter.id?' · Selected':''}</b><small>{x.code} · {x.count} records</small></span><span className="comparison-track"><i style={{width:`${Math.min(100,x.avg/maxBar*100)}%`}}/></span><b className="comparison-value">{pct(x.avg)}</b></div>)}</div>:<p className="muted">Comparison will appear when scores have been recorded for active shooters.</p>}</section>
  <section className="performance-section fees-section"><div className="performance-section-head"><div><h3>Fees & payment history</h3><p>Recorded payments and outstanding amounts</p></div><span className="count">{fees.length} fees</span></div><div className="fee-summary-line"><span><i className="paid-dot"/> Paid <b>{money(paid)}</b></span><span><i className="pending-dot"/> Pending <b>{money(pending)}</b></span><span><i className="overdue-dot"/> Overdue <b>{money(overdue)}</b></span></div><div className="performance-list">{fees.slice(0,7).map(x=><div className="record-row" key={x.id}><span><b>{x.title}</b><small>Due {x.due_date?new Date(`${x.due_date}T00:00:00`).toLocaleDateString('en-IN'):'—'}{x.paid_at?` · Paid ${new Date(x.paid_at).toLocaleDateString('en-IN')}`:''}</small></span><span className={`badge ${x.status==='paid'?'green':x.due_date&&new Date(`${x.due_date}T23:59:59`)<now?'red':'amber'}`}>{x.status==='paid'?'Paid':x.due_date&&new Date(`${x.due_date}T23:59:59`)<now?'Overdue':'Pending'} · {money(x.amount)}</span></div>)}{!fees.length&&<p className="muted">No fee records yet.</p>}</div></section>
 </div>}
 <div className="modal-actions"><button className="secondary" onClick={onClose}>Close profile</button></div></div></div>;
}
