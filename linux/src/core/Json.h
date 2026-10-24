#pragma once

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QString>

#include <cmath>
#include <optional>

namespace dayhand::json {

/// A whole number, also when the server sends it as a double (Convex sends `v.number()` as `1.0`).
inline std::optional<qint64> integer(const QJsonValue &value)
{
    if (!value.isDouble())
        return std::nullopt;
    const double number = value.toDouble();
    if (!std::isfinite(number) || std::floor(number) != number || std::fabs(number) > 9.007199254740992e15)
        return std::nullopt;
    return static_cast<qint64>(number);
}

inline std::optional<int> int32(const QJsonValue &value)
{
    const auto number = integer(value);
    if (!number || *number < INT32_MIN || *number > INT32_MAX)
        return std::nullopt;
    return static_cast<int>(*number);
}

inline std::optional<QString> string(const QJsonValue &value)
{
    if (!value.isString())
        return std::nullopt;
    return value.toString();
}

inline QJsonValue orNull(const std::optional<QString> &value)
{
    return value ? QJsonValue(*value) : QJsonValue(QJsonValue::Null);
}

inline QJsonValue orNull(const std::optional<qint64> &value)
{
    return value ? QJsonValue(*value) : QJsonValue(QJsonValue::Null);
}

/// Compact JSON with sorted keys (QJsonObject keeps its keys sorted).
inline QString encode(const QJsonObject &object)
{
    return QString::fromUtf8(QJsonDocument(object).toJson(QJsonDocument::Compact));
}

inline QString encode(const QJsonArray &array)
{
    return QString::fromUtf8(QJsonDocument(array).toJson(QJsonDocument::Compact));
}

/// The value [text] holds, or Undefined when it is not JSON.
inline QJsonValue decode(const QByteArray &text)
{
    QJsonParseError error{};
    // A bare value ("1", "\"x\"") is wrapped so QJsonDocument accepts it.
    const auto document = QJsonDocument::fromJson("[" + text + "]", &error);
    if (error.error != QJsonParseError::NoError || !document.isArray() || document.array().size() != 1)
        return QJsonValue(QJsonValue::Undefined);
    return document.array().first();
}

inline QJsonValue decode(const QString &text)
{
    return decode(text.toUtf8());
}

} // namespace dayhand::json
