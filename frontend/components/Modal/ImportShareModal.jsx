"use client";

// <ImportShareModal /> : 공유 링크로 들어온 경우 뜨는 확인 모달. 공유받은 매물 미리보기를
// 보여주고, "내 목록에 추가"를 누르면 지금 내 관심 매물 목록 뒤에 이어 붙인다.
//
//   ?share=<token>       매물 스냅샷(groupName 없음)
//   ?groupShare=<token>  그룹 링크(groupName 있음). 그룹 이름을 함께 보여준다.
//
// 교체가 아니라 "추가"인 이유: 공유는 남이 보낸 링크를 여는 것뿐인데,
// 그걸 열었다고 내가 이미 만들어둔 목록이 통째로 사라지면 안 되기 때문이다.
// 그룹 링크를 열어도 그 그룹에 참여하지는 않는다(공동 참여는 보류).

function withSuffix(value, suffix) {
  return value.endsWith(suffix) ? value : `${value}${suffix}`;
}

// "101동 1203호 · 84.95㎡". 동·호수가 없으면 면적만.
function detailLabel(item) {
  const unit = [item.dong && withSuffix(item.dong, "동"), item.ho && withSuffix(item.ho, "호")]
    .filter(Boolean)
    .join(" ");
  const size = item.representative_area != null ? `${item.representative_area}㎡` : `평형 ${item.size_id}`;
  return unit ? `${unit} · ${size}` : size;
}

export default function ImportShareModal({ open, items, groupName = null, onImport, onCancel }) {
  const title = groupName ? "공유받은 그룹" : "공유받은 관심 매물";
  let summary = `${items.length}개의 매물을 받았어요. 내 목록에 추가할까요?`;
  if (groupName) {
    summary = items.length === 0
      ? `"${groupName}" 그룹에 아직 후보가 없어요.`
      : `"${groupName}" 그룹의 매물 ${items.length}개를 받았어요. 내 목록에 추가할까요?`;
  }

  return (
    <div
      className={"edit-overlay" + (open ? " is-open" : "")}
      inert={!open}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="edit-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="edit-dialog-title">{title}</div>
        <div className="edit-dialog-name">{summary}</div>

        {items.length > 0 && (
          <div className="share-preview-list">
            {items.map((item, i) => (
              <div className="share-preview-row" key={i}>
                <span className="share-preview-name">
                  {item.complex_name || "단지 정보 준비중"}
                </span>
                <span className="share-preview-size">{detailLabel(item)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="edit-dialog-actions">
          <button type="button" className="edit-dialog-cancel" tabIndex={0} onClick={onCancel}>
            닫기
          </button>
          <button
            type="button"
            className="edit-dialog-save"
            tabIndex={0}
            disabled={items.length === 0}
            onClick={onImport}
          >
            내 목록에 추가
          </button>
        </div>
      </div>
    </div>
  );
}
