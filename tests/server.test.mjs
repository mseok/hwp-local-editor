import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
test('server exposes only allowlisted loopback resources',async()=>{
  const port=18766;
  const child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',v=>stderr+=v);
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('server startup timeout '+stderr)),10000);
      child.once('error',reject);child.once('exit',code=>reject(new Error('server exited '+code+' '+stderr)));
      child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
    });
    const call=(pathname,headers={},method='GET')=>new Promise((resolve,reject)=>{
      const req=request({host:'127.0.0.1',port,path:pathname,headers,method},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();
    });
    assert.equal((await call('/editor')).status,200);
    assert.equal((await call('/documents.json')).body,'[]');
    assert.equal((await call('/font-catalog.json')).status,200);
    assert.equal((await call('/editor',{Host:'attacker.example'})).status,403);
    assert.equal((await call('/editor',{},'POST')).status,403);
    assert.equal((await call('/.git/config')).status,404);
    assert.equal((await call('/document/private/source')).status,404);
    assert.ok([403,404].includes((await call('/rhwp/%2e%2e%2f%2e%2e%2fpackage.json')).status));
  }finally{
    if(child.exitCode===null&&child.signalCode===null){
      const closed=new Promise(resolve=>child.once('close',resolve));
      child.kill();await closed;
    }
  }
});
