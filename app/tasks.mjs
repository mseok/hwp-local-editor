const status = document.querySelector('#status');
async function refresh() {
  try {
    const response = await fetch('/documents.json');
    if (!response.ok) throw new Error('목록을 읽지 못했습니다.');
    const documents = await response.json();
    document.querySelector('#documents').replaceChildren(...documents.map(doc => {
      const article = document.createElement('article');
      article.dataset.documentId = doc.id;
      const title = document.createElement('h2'); title.textContent = doc.name;
      const state = document.createElement('p'); state.textContent = doc.receipt ? `결과 저장됨 · ${doc.receipt.pageCount}쪽 · 저장 버전 ${doc.revision}` : '결과 파일 저장 대기';
      const nav = document.createElement('nav');
      const link = (text,href) => { const anchor = document.createElement('a'); anchor.textContent=text;anchor.href=href;anchor.target='_blank';anchor.rel='noopener';return anchor; };
      nav.append(link('원본에서 편집',`/editor?id=${doc.id}`));
      if (doc.receipt) nav.append(link('저장 결과 다시 열기',`/editor?id=${doc.id}&result=1`),link('결과 미리보기',`/?document=${doc.id}&result=1`),link('결과 다운로드',`/document/${doc.id}/result`));
      const receipt = document.createElement('p');receipt.className='receipt';receipt.textContent=doc.receipt ? `${doc.receipt.name}\n${doc.receipt.path}\n검증: 엔진 재열기, 텍스트·형식 일치` : '';
      article.append(title,state,nav,receipt);return article;
    }));
    status.textContent = documents.length ? `${documents.length}개 문서 · ${documents.filter(d=>d.receipt).length}개 결과 저장됨` : '등록된 파일이 없습니다. scripts/open.mjs로 파일을 등록하거나 편집기에서 파일을 선택하세요.';
  } catch(error) { status.textContent = error.message; }
}
document.querySelector('#refresh').addEventListener('click',refresh);
await refresh();
