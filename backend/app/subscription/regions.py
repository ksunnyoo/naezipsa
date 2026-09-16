"""청약 지역명 정규화와 시·도별 표시 그룹."""

REGIONS = {
    "11": "서울", "26": "부산", "27": "대구", "28": "인천", "29": "광주",
    "30": "대전", "31": "울산", "36": "세종", "41": "경기", "42": "강원",
    "43": "충북", "44": "충남", "45": "전북", "46": "전남", "47": "경북",
    "48": "경남", "50": "제주", "51": "강원", "52": "전북",
}
ALIASES = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
    "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
    "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기",
    "강원도": "강원", "강원특별자치도": "강원", "충청북도": "충북",
    "충청남도": "충남", "전라북도": "전북", "전북특별자치도": "전북",
    "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
    "제주도": "제주", "제주특별자치도": "제주",
}
CATEGORIES = (
    ("general", "일반공급"),
    ("special", "특별공급"),
    ("no-rank", "무순위/잔여세대"),
    ("officetel", "오피스텔"),
    ("urban-living", "도시형생활주택"),
    ("private-rental", "민간임대"),
    ("living-accommodation", "생활숙박시설"),
    ("public-supported-private-rental", "공공지원민간임대"),
)
CATEGORY_BY_KEY = dict(CATEGORIES)
LEGACY_CATEGORY_ALIASES = {"priority-1": "general"}


def normalize_category(category):
    if category is None:
        return None
    return LEGACY_CATEGORY_ALIASES.get(category, category)


def normalize_region(value):
    value = (value or "").strip()
    return ALIASES.get(value, value) or "지역 미상"


def preferred_regions_from_codes(codes):
    return list(dict.fromkeys(REGIONS[str(code)[:2]] for code in codes if str(code)[:2] in REGIONS))

# 지역 정렬용 대략적인 대표 지점(위도, 경도). 행정구역 경계·매물 좌표가 아니다.
# 넓은 도 지역은 도심 대표 지점을 사용하며 distance_km는 이동거리가 아니다.
REFERENCE_POINTS = {
    "서울": (37.57, 126.98), "경기": (37.27, 127.01), "인천": (37.46, 126.71),
    "강원": (37.88, 127.73), "충북": (36.64, 127.49), "충남": (36.66, 126.67),
    "세종": (36.48, 127.29), "대전": (36.35, 127.38), "전북": (35.82, 127.15),
    "전남": (34.82, 126.46), "광주": (35.16, 126.85), "경북": (36.57, 128.73),
    "대구": (35.87, 128.60), "경남": (35.23, 128.68), "울산": (35.54, 129.31),
    "부산": (35.18, 129.08), "제주": (33.50, 126.53),
}


def distance_km(first, second):
    from math import asin, cos, radians, sin, sqrt

    lat1, lon1 = map(radians, REFERENCE_POINTS[first])
    lat2, lon2 = map(radians, REFERENCE_POINTS[second])
    value = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * asin(min(1, sqrt(value)))


def group_announcements(items, preferred_regions, limit_per_region=3):
    preferred = list(dict.fromkeys(normalize_region(region) for region in preferred_regions))
    preferred = [region for region in preferred if region in REFERENCE_POINTS]

    def proximity(region):
        if not preferred or region not in REFERENCE_POINTS:
            return None
        return min(distance_km(region, origin) for origin in preferred)

    def sort_key(region):
        if region in preferred:
            return (0, preferred.index(region), region)
        distance = proximity(region)
        return (1, distance if distance is not None else float("inf"), region)

    grouped = {category: {} for category, _ in CATEGORIES}
    for item in items:
        category = normalize_category(item.get("category"))
        if category not in grouped:
            grouped.setdefault(category, {})
        region = normalize_region(item.get("region"))
        grouped.setdefault(category, {}).setdefault(region, []).append({**item, "region": region, "region_label": f"[{region}]"})

    categories = []
    for category, label in CATEGORIES:
        groups = grouped.get(category, {})
        regions = []
        for region in sorted({**{region: None for region in preferred}, **{region: None for region in groups}}, key=sort_key):
            rows = sorted(groups.get(region, []), key=lambda item: item.get("announced_at") or "", reverse=True)
            distance = proximity(region)
            regions.append({
                "region": region, "label": f"[{region}]", "is_preferred": region in preferred,
                "distance_km": round(distance, 1) if distance is not None else None,
                "count": len(rows[:limit_per_region]), "total_count": len(rows),
                "items": rows[:limit_per_region],
                "message": None if rows else "조건에 맞는 데이터가 없습니다.",
            })
        if not preferred and not groups:
            regions = []
        category_label = next((item.get("label") for item in items if normalize_category(item.get("category")) == category), None) or label
        categories.append({
            "category": category,
            "label": category_label,
            "regions": regions,
            "message": None if any(group["items"] for group in regions) else "조건에 맞는 데이터가 없습니다.",
        })
    return {"status": "success", "preferred_regions": preferred,
            "sort_basis": "region_reference_point_distance" if preferred else "region_name",
            "distance_is_approximate": True,
            "count": sum(group["count"] for category in categories for group in category["regions"]),
            "data": categories}
