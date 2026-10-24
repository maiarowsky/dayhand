#include "Credentials.h"

// glib's headers use the identifier "signals", which Qt defines as a macro.
#undef signals
#include <libsecret/secret.h>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

const SecretSchema *schema()
{
    static const SecretSchema value = {
        SecretServiceStore::schemaName,
        SECRET_SCHEMA_NONE,
        {
            {"account", SECRET_SCHEMA_ATTRIBUTE_STRING},
            {nullptr, SecretSchemaAttributeType(0)},
        },
        0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr,
    };
    return &value;
}

constexpr const char *account = "device";

/// The domain and code of a failure, never its message (which may hold more than we want in a log).
QString describe(GError *error)
{
    const QString text = u"Secret Service error %1/%2"_s.arg(QString::fromUtf8(g_quark_to_string(error->domain))).arg(error->code);
    g_error_free(error);
    return text;
}

} // namespace

CredentialLoad SecretServiceStore::load()
{
    GError *error = nullptr;
    gchar *secret = secret_password_lookup_sync(schema(), nullptr, &error, "account", account, nullptr);
    if (error)
        return {std::nullopt, describe(error)};
    if (!secret)
        return {std::nullopt, {}};
    const QString text = QString::fromUtf8(secret);
    secret_password_free(secret);
    return {DeviceCredential::fromJson(text), {}};
}

QString SecretServiceStore::save(const DeviceCredential &credential)
{
    GError *error = nullptr;
    const QByteArray secret = credential.toJson().toUtf8();
    secret_password_store_sync(schema(), SECRET_COLLECTION_DEFAULT, "Dayhand server sign-in", secret.constData(),
                               nullptr, &error, "account", account, nullptr);
    return error ? describe(error) : QString();
}

QString SecretServiceStore::remove()
{
    GError *error = nullptr;
    secret_password_clear_sync(schema(), nullptr, &error, "account", account, nullptr);
    return error ? describe(error) : QString();
}

} // namespace dayhand
