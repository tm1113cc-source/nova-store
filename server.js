const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000, ROOT=__dirname, DB=path.join(ROOT,'data.json');
const ADMIN_USER=process.env.ADMIN_USER||'admin', ADMIN_PASS=process.env.ADMIN_PASS||'';
if(!ADMIN_PASS||ADMIN_PASS==='change-me-now'){console.error('FATAL: set a strong ADMIN_PASS environment variable.');process.exit(1)}
const sessions=new Map(),SESSION_MS=12*3600*1000,fails=new Map(),MAX_FAILS=5,LOCK_MS=15*60*1000;
function ip(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim()}
function same(a,b){const h=x=>crypto.createHash('sha256').update(String(x)).digest();return crypto.timingSafeEqual(h(a),h(b))}
function locked(k){const f=fails.get(k);if(!f||!f.until)return 0;if(f.until>Date.now())return f.until-Date.now();fails.delete(k);return 0}
function fail(k){const f=fails.get(k)||{n:0};if(Date.now()-(f.t||0)>LOCK_MS)f.n=0;f.t=Date.now();if(++f.n>=MAX_FAILS){f.until=Date.now()+LOCK_MS;f.n=0}fails.set(k,f)}
setInterval(()=>{const n=Date.now();sessions.forEach((e,t)=>{if(e<n)sessions.delete(t)});fails.forEach((f,k)=>{if(n-f.t>LOCK_MS&&!(f.until>n))fails.delete(k)})},600000).unref();
function seed(){return {categories:[{id:1,name:'AI 工具'},{id:2,name:'创作工具'},{id:3,name:'会员服务'},{id:4,name:'开发工具'},{id:5,name:'效率工具'}],products:[
{id:1,name:'视频剪辑 Pro｜1个月',price:17,stock:20,category_id:2,icon:'✂',badge:'推荐',status:1},
{id:2,name:'AI Plus｜月度会员',price:29,stock:15,category_id:1,icon:'◎',badge:'推荐',status:1},
{id:3,name:'AI Pro｜高级会员',price:99,stock:8,category_id:1,icon:'◎',badge:'推荐',status:1},
{id:4,name:'AI Pro｜年度方案',price:599,stock:5,category_id:1,icon:'◉',badge:'特惠',status:1},
{id:5,name:'AI Max｜专业方案',price:899,stock:3,category_id:1,icon:'◎',badge:'推荐',status:1},
{id:6,name:'开发者工具｜月度',price:19,stock:12,category_id:4,icon:'◇',badge:'推荐',status:1},
{id:7,name:'智能办公套件',price:8,stock:30,category_id:5,icon:'✦',badge:'推荐',status:1},
{id:8,name:'创作会员｜季度',price:24,stock:16,category_id:3,icon:'◉',badge:'特惠',status:1},
{id:9,name:'NOVA Premium｜6个月',price:44,stock:9,category_id:3,icon:'N',badge:'推荐',status:1},
{id:10,name:'社交工具增强服务',price:12,stock:22,category_id:5,icon:'X',badge:'推荐',status:1}],orders:[],settings:{site_name:'NOVA DIGITAL STORE',announcement:'数字服务，一站直达。'}}}
let cache=null,pool=null,chain=Promise.resolve();
const clone=o=>JSON.parse(JSON.stringify(o));
function read(){if(!cache){if(!fs.existsSync(DB))fs.writeFileSync(DB,JSON.stringify(seed(),null,2));cache=JSON.parse(fs.readFileSync(DB))}return clone(cache)}
function write(d){cache=clone(d);if(pool)persist(cache);else fs.writeFileSync(DB,JSON.stringify(d,null,2))}
function persist(d){const j=JSON.stringify(d);chain=chain.then(()=>pool.query("insert into kv(k,v) values('db',$1) on conflict(k) do update set v=excluded.v",[j])).catch(e=>console.error('db write failed:',e.message))}
async function init(){
if(!process.env.DATABASE_URL)return;
const {Pool}=require('pg');
pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:3});
await pool.query('create table if not exists kv(k text primary key,v jsonb not null)');
const r=await pool.query("select v from kv where k='db'");
if(r.rows.length)cache=r.rows[0].v;
else{cache=fs.existsSync(DB)?JSON.parse(fs.readFileSync(DB)):seed();persist(cache)}
}
process.on('SIGTERM',()=>chain.then(()=>process.exit(0)));
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj))}
function body(req){return new Promise((ok,no)=>{let s='';req.on('data',d=>{s+=d;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){no(e)}})})}
function token(req){return (req.headers.authorization||'').replace('Bearer ','')}
function auth(req){const t=token(req),e=sessions.get(t);if(!e)return false;if(e<Date.now()){sessions.delete(t);return false}return true}
function products(db){return db.products.filter(p=>p.status).map(p=>({...p,category_name:(db.categories.find(c=>c.id==p.category_id)||{}).name||''}))}
const qrl=new Map();
function qOk(ip){if(qrl.size>5000)qrl.clear();const n=Date.now(),a=(qrl.get(ip)||[]).filter(t=>n-t<6e4);if(a.length>=10){qrl.set(ip,a);return false}a.push(n);qrl.set(ip,a);return true}
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://localhost'), db=read();
  if(u.pathname==='/api/products'&&req.method==='GET')return json(res,200,products(db));
  if(u.pathname==='/api/order'&&req.method==='GET'){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',').pop().trim();if(!qOk(ip))return json(res,429,{error:'查询过于频繁，请稍后再试'});const q=new URL(req.url,'http://x').searchParams,no=String(q.get('no')||'').trim(),em=String(q.get('email')||'').trim().toLowerCase();const o=no&&em&&db.orders.find(x=>x.order_no===no&&String(x.email||'').trim().toLowerCase()===em);if(!o)return json(res,404,{error:'未找到订单，请核对订单号和邮箱'});return json(res,200,{order_no:o.order_no,product_name:o.product_name,amount:o.amount,status:o.status,created_at:o.created_at})}
  if(u.pathname==='/api/settings'&&req.method==='GET')return json(res,200,db.settings);
  if(u.pathname==='/api/orders'&&req.method==='POST'){const b=await body(req),p=db.products.find(x=>x.id===+b.product_id&&x.status);if(!p)return json(res,404,{error:'商品不存在'});if(!b.email)return json(res,400,{error:'缺少邮箱'});if(p.stock<1)return json(res,400,{error:'库存不足'});p.stock--;const o={id:Date.now(),order_no:'N'+Date.now(),product_id:p.id,product_name:p.name,amount:p.price,email:b.email,status:'待处理',created_at:new Date().toISOString()};db.orders.unshift(o);write(db);return json(res,201,o)}
  if(u.pathname==='/api/admin/login'&&req.method==='POST'){const k=ip(req),w=locked(k);if(w)return json(res,429,{error:'尝试次数过多，请 '+Math.ceil(w/60000)+' 分钟后再试'});const b=await body(req);if(!same(b.username,ADMIN_USER)|!same(b.password,ADMIN_PASS)){fail(k);return json(res,401,{error:'账号或密码错误'})}fails.delete(k);const t=crypto.randomBytes(24).toString('hex');sessions.set(t,Date.now()+SESSION_MS);return json(res,200,{token:t})}
  if(u.pathname.startsWith('/api/admin/')){if(!auth(req))return json(res,401,{error:'未登录'});
   if(u.pathname==='/api/admin/dashboard')return json(res,200,{products:db.products.length,orders:db.orders.length,revenue:db.orders.reduce((s,o)=>s+o.amount,0),low_stock:db.products.filter(p=>p.stock<5).length});
   if(u.pathname==='/api/admin/products'&&req.method==='GET')return json(res,200,db.products);
   if(u.pathname==='/api/admin/products'&&req.method==='POST'){const b=await body(req);const p={id:Date.now(),name:b.name||'未命名商品',price:+b.price||0,stock:+b.stock||0,category_id:+b.category_id||1,icon:b.icon||'✦',badge:b.badge||'推荐',status:b.status===0?0:1};db.products.unshift(p);write(db);return json(res,201,p)}
   let m=u.pathname.match(/^\/api\/admin\/products\/(\d+)$/);if(m&&req.method==='PUT'){const b=await body(req),p=db.products.find(x=>x.id===+m[1]);if(!p)return json(res,404,{error:'不存在'});Object.assign(p,b,{price:+b.price,stock:+b.stock,category_id:+b.category_id,status:+b.status});write(db);return json(res,200,p)}
   if(m&&req.method==='DELETE'){db.products=db.products.filter(x=>x.id!==+m[1]);write(db);return json(res,200,{ok:true})}
   if(u.pathname==='/api/admin/orders'&&req.method==='GET')return json(res,200,db.orders);
   if(u.pathname==='/api/admin/settings'&&req.method==='PUT'){const b=await body(req);if(typeof b.announcement!=='string')return json(res,400,{error:'格式错误'});db.settings.announcement=b.announcement.trim().slice(0,500);write(db);return json(res,200,db.settings)}
let om=u.pathname.match(/^\/api\/admin\/orders\/(\d+)$/);if(om&&req.method==='PUT'){const b=await body(req),o=db.orders.find(x=>x.id===+om[1]);if(!o)return json(res,404,{error:'不存在'});o.status=b.status||o.status;write(db);return json(res,200,o)}
  }
  const pages={'/':'index.html','/index.html':'index.html','/admin':'admin.html','/admin/':'admin.html'};
  if(pages[u.pathname]){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return fs.createReadStream(path.join(ROOT,pages[u.pathname])).pipe(res)}
  res.writeHead(404);res.end('Not found');
 }catch(e){console.error(e);json(res,500,{error:'服务器错误'})}
});
init().then(()=>server.listen(PORT,()=>console.log(`NOVA Store: http://localhost:${PORT}  Admin: http://localhost:${PORT}/admin`))).catch(e=>{console.error('DB init failed:',e.message);process.exit(1)});