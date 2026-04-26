#include "utils/polygonUtils.h"

namespace cura
{

const std::function<int(Point)> PolygonUtils::no_penalty_function = [](Point)
{
    return 0;
};

void PolygonUtils::fixSelfIntersections(const coord_t, Polygons&)
{
}

Polygons PolygonUtils::unionManySmall(const Polygons& p)
{
    return p.unionPolygons();
}

} // namespace cura
