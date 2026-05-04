#ifndef CINDR3D_WASM_STUB_POLYCLIPPING_CLIPPER_HPP
#define CINDR3D_WASM_STUB_POLYCLIPPING_CLIPPER_HPP

#include <cstdint>
#include <algorithm>
#include <memory>
#include <vector>

#include <clipper2/clipper.h>

namespace ClipperLib
{
using cInt = int64_t;

struct IntPoint
{
    cInt X;
    cInt Y;
    cInt Z;

    constexpr IntPoint(cInt x = 0, cInt y = 0, cInt z = 0)
        : X(x)
        , Y(y)
        , Z(z)
    {
    }
};

inline bool operator==(const IntPoint& a, const IntPoint& b)
{
    return a.X == b.X && a.Y == b.Y && a.Z == b.Z;
}

inline bool operator!=(const IntPoint& a, const IntPoint& b)
{
    return ! (a == b);
}

using Path = std::vector<IntPoint>;
using Paths = std::vector<Path>;

inline double Area(const Path& path)
{
    double area = 0.0;
    if (path.size() < 3) return area;
    for (size_t i = 0, j = path.size() - 1; i < path.size(); j = i++)
    {
        area += static_cast<double>(path[j].X) * static_cast<double>(path[i].Y)
              - static_cast<double>(path[i].X) * static_cast<double>(path[j].Y);
    }
    return area / 2.0;
}

inline bool Orientation(const Path& path)
{
    return Area(path) >= 0.0;
}

inline int PointInPolygon(const IntPoint& point, const Path& path)
{
    bool inside = false;
    if (path.size() < 3) return 0;
    for (size_t i = 0, j = path.size() - 1; i < path.size(); j = i++)
    {
        const IntPoint& pi = path[i];
        const IntPoint& pj = path[j];
        if ((pi.Y > point.Y) != (pj.Y > point.Y)
            && point.X < (pj.X - pi.X) * (point.Y - pi.Y) / static_cast<double>(pj.Y - pi.Y) + pi.X)
        {
            inside = !inside;
        }
    }
    return inside ? 1 : 0;
}

inline void ReversePath(Path& path)
{
    std::reverse(path.begin(), path.end());
}

enum JoinType
{
    jtSquare,
    jtRound,
    jtMiter,
};

enum EndType
{
    etClosedPolygon,
    etClosedLine,
    etOpenButt,
    etOpenSquare,
    etOpenRound,
};

enum PolyType
{
    ptSubject,
    ptClip,
};

enum ClipType
{
    ctIntersection,
    ctUnion,
    ctDifference,
    ctXor,
};

enum PolyFillType
{
    pftEvenOdd,
    pftNonZero,
    pftPositive,
    pftNegative,
};

enum InitOptions
{
    ioReverseSolution = 1,
    ioStrictlySimple = 2,
    ioPreserveCollinear = 4,
};

class PolyNode
{
public:
    Path Contour;
    std::vector<PolyNode*> Childs;
    bool is_hole = false;

    virtual ~PolyNode() = default;

    bool IsHole() const
    {
        return is_hole;
    }

    int ChildCount() const
    {
        return static_cast<int>(Childs.size());
    }
};

class PolyTree : public PolyNode
{
public:
    std::vector<std::unique_ptr<PolyNode>> owned_nodes;

    void Clear()
    {
        Childs.clear();
        owned_nodes.clear();
    }
};

inline Clipper2Lib::Path64 toClipper2Path(const Path& path)
{
    Clipper2Lib::Path64 out;
    out.reserve(path.size());
    for (const IntPoint& pt : path)
    {
        out.emplace_back(pt.X, pt.Y);
    }
    return out;
}

inline Clipper2Lib::Paths64 toClipper2Paths(const Paths& paths)
{
    Clipper2Lib::Paths64 out;
    out.reserve(paths.size());
    for (const Path& path : paths)
    {
        if (path.size() >= 2)
        {
            out.push_back(toClipper2Path(path));
        }
    }
    return out;
}

inline Path fromClipper2Path(const Clipper2Lib::Path64& path)
{
    Path out;
    out.reserve(path.size());
    for (const Clipper2Lib::Point64& pt : path)
    {
        out.emplace_back(pt.x, pt.y);
    }
    return out;
}

inline Paths fromClipper2Paths(const Clipper2Lib::Paths64& paths)
{
    Paths out;
    out.reserve(paths.size());
    for (const Clipper2Lib::Path64& path : paths)
    {
        if (path.size() >= 2)
        {
            out.push_back(fromClipper2Path(path));
        }
    }
    return out;
}

inline Clipper2Lib::FillRule toFillRule(PolyFillType fill_type)
{
    switch (fill_type)
    {
    case pftNonZero:
        return Clipper2Lib::FillRule::NonZero;
    case pftPositive:
        return Clipper2Lib::FillRule::Positive;
    case pftNegative:
        return Clipper2Lib::FillRule::Negative;
    case pftEvenOdd:
    default:
        return Clipper2Lib::FillRule::EvenOdd;
    }
}

inline Clipper2Lib::ClipType toClipType(ClipType clip_type)
{
    switch (clip_type)
    {
    case ctIntersection:
        return Clipper2Lib::ClipType::Intersection;
    case ctUnion:
        return Clipper2Lib::ClipType::Union;
    case ctDifference:
        return Clipper2Lib::ClipType::Difference;
    case ctXor:
    default:
        return Clipper2Lib::ClipType::Xor;
    }
}

inline Clipper2Lib::JoinType toJoinType(JoinType join_type)
{
    switch (join_type)
    {
    case jtSquare:
        return Clipper2Lib::JoinType::Square;
    case jtRound:
        return Clipper2Lib::JoinType::Round;
    case jtMiter:
    default:
        return Clipper2Lib::JoinType::Miter;
    }
}

inline void PolyTreeToPaths(const PolyTree& tree, Paths& paths)
{
    paths.clear();
    for (const PolyNode* child : tree.Childs)
    {
        if (child)
        {
            paths.push_back(child->Contour);
        }
    }
}

inline void OpenPathsFromPolyTree(const PolyTree& tree, Paths& paths)
{
    PolyTreeToPaths(tree, paths);
}

inline void SimplifyPolygons(Paths& paths, PolyFillType fill_type = pftEvenOdd)
{
    paths = fromClipper2Paths(Clipper2Lib::Union(toClipper2Paths(paths), toFillRule(fill_type)));
}

class ClipperOffset
{
public:
    double MiterLimit;
    double ArcTolerance;
    JoinType join_type = jtMiter;
    Paths input_paths;

    ClipperOffset(double miter_limit = 2.0, double arc_tolerance = 0.25)
        : MiterLimit(miter_limit)
        , ArcTolerance(arc_tolerance)
    {
    }

    void AddPath(const Path& path, JoinType jt, EndType)
    {
        join_type = jt;
        input_paths.push_back(path);
    }

    void AddPaths(const Paths& paths, JoinType jt, EndType)
    {
        join_type = jt;
        input_paths.insert(input_paths.end(), paths.begin(), paths.end());
    }

    void Execute(Paths& solution, double distance)
    {
        solution = fromClipper2Paths(Clipper2Lib::InflatePaths(
            toClipper2Paths(input_paths),
            distance,
            toJoinType(join_type),
            Clipper2Lib::EndType::Polygon,
            MiterLimit,
            ArcTolerance));
    }
};

class Clipper
{
public:
    Paths subject_paths;
    Paths clip_paths;

    explicit Clipper(int = 0)
    {
    }

    void AddPath(const Path& path, PolyType type, bool)
    {
        (type == ptClip ? clip_paths : subject_paths).push_back(path);
    }

    void AddPaths(const Paths& paths, PolyType type, bool)
    {
        Paths& target = type == ptClip ? clip_paths : subject_paths;
        target.insert(target.end(), paths.begin(), paths.end());
    }

    bool Execute(ClipType clip_type, Paths& solution, PolyFillType subj_fill = pftEvenOdd, PolyFillType = pftEvenOdd)
    {
        solution = fromClipper2Paths(Clipper2Lib::BooleanOp(
            toClipType(clip_type),
            toFillRule(subj_fill),
            toClipper2Paths(subject_paths),
            toClipper2Paths(clip_paths)));
        return true;
    }

    bool Execute(ClipType clip_type, PolyTree& solution, PolyFillType subj_fill = pftEvenOdd, PolyFillType clip_fill = pftEvenOdd)
    {
        Paths paths;
        Execute(clip_type, paths, subj_fill, clip_fill);
        solution.Clear();
        for (const Path& path : paths)
        {
            auto owned = std::make_unique<PolyNode>();
            PolyNode* node = owned.get();
            node->Contour = path;
            node->is_hole = !Orientation(path);
            solution.Childs.push_back(node);
            solution.owned_nodes.push_back(std::move(owned));
        }
        return true;
    }
};
} // namespace ClipperLib

#endif // CINDR3D_WASM_STUB_POLYCLIPPING_CLIPPER_HPP
