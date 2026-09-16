import Dashboard from "./Dashboard/Dashboard";
import MainHeroOverlay from "./Hero/MainHeroOverlay";

// <Workspace /> : 헤더 아래 남는 영역 전체. Dashboard(항상 존재, 아래 레이어.
// 왼쪽 리스트 고정 + 오른쪽만 상세 데이터/인사이트로 슬라이드)와
// MainHeroOverlay(위 레이어, 블러 처리된 반투명 상태로 전체를 덮고 있다가
// 관심 매물을 한 번이라도 추가하면 위로 슬라이드되며 사라짐)가 겹쳐서
// 배치된다.
export default function Workspace({
  items,
  totalCount,
  insightItems,
  userId,
  profile,
  onToggle,
  onEdit,
  onRemove,
  onReorder,
  onAdd,
  heroCleared,
  showHeroCloseBtn,
  onHeroClose,
  activeContentTab,
  dragDisabled,
}) {
  return (
    <div className="workspace" data-component="Workspace">
      <Dashboard
        items={items}
        totalCount={totalCount}
        insightItems={insightItems}
        userId={userId}
        profile={profile}
        onToggle={onToggle}
        onEdit={onEdit}
        onRemove={onRemove}
        onReorder={onReorder}
        onAdd={onAdd}
        activeContentTab={activeContentTab}
        dragDisabled={dragDisabled}
      />
      <MainHeroOverlay
        cleared={heroCleared}
        showCloseBtn={showHeroCloseBtn}
        onClose={onHeroClose}
        onCtaClick={onAdd}
      />
    </div>
  );
}
