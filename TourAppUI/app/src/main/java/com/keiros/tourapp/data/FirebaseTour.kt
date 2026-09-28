package com.keiros.tourapp.data

import com.keiros.tourapp.BuildConfig
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object FirebaseTour {
    fun enabled(): Boolean = BuildConfig.FIREBASE_PROJECT_ID.isNotBlank() && BuildConfig.FIREBASE_API_KEY.isNotBlank()

    fun lookup(propertyId: String): PropertyMeta? {
        if (!enabled() || propertyId.isBlank()) return null
        val site = getDocument("site_properties", propertyId)
        val complex = getDocument("complexes", propertyId)
        val codeDoc = findCode(propertyId)
        val codeStatus = codeDoc?.optString("status").orEmpty()
        if (codeStatus.equals("Revoked", true) || codeStatus.equals("Expired", true)) {
            throw IllegalStateException("This property code is $codeStatus.")
        }
        val name = site?.optString("name").orEmpty()
            .ifBlank { complex?.optString("name").orEmpty() }
            .ifBlank { codeDoc?.optString("propertyName").orEmpty() }
        if (name.isBlank() && codeDoc == null) return null
        val city = site?.optString("city").orEmpty().ifBlank { complex?.optString("city").orEmpty() }
        val address = site?.optString("address").orEmpty().ifBlank { complex?.optString("address").orEmpty() }
        val buildings = intField(site, "buildings") ?: intField(complex, "buildings") ?: 1
        return PropertyMeta(
            code = codeDoc?.optString("code").orEmpty().ifBlank { propertyId },
            propertyId = propertyId,
            name = name.ifBlank { "Property $propertyId" },
            city = city,
            state = "",
            address = address,
            buildings = buildings,
        )
    }

    fun loadMap(propertyId: String): PropertyTour? {
        if (!enabled() || propertyId.isBlank()) return null
        val floors = query("floors", "propertyId", propertyId, 80)
        val locations = query("locations", "propertyId", propertyId, 250)
        val buildings = query("buildings", "complexId", propertyId, 20)
        return TourBuilder.fromFirebase(propertyId, buildings, floors, locations)
    }

    private fun query(collection: String, field: String, value: String, limit: Int): List<JSONObject> {
        val body = JSONObject()
            .put(
                "structuredQuery",
                JSONObject()
                    .put("from", org.json.JSONArray().put(JSONObject().put("collectionId", collection)))
                    .put(
                        "where",
                        JSONObject().put(
                            "fieldFilter",
                            JSONObject()
                                .put("field", JSONObject().put("fieldPath", field))
                                .put("op", "EQUAL")
                                .put("value", JSONObject().put("stringValue", value)),
                        ),
                    )
                    .put("limit", limit),
            )
        val conn = open(endpoint("documents:runQuery"), "POST")
        conn.doOutput = true
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        val text = read(conn)
        if (text.isBlank()) return emptyList()
        val rows = org.json.JSONArray(if (text.trim().startsWith("[")) text else "[$text]")
        val docs = ArrayList<JSONObject>()
        for (i in 0 until rows.length()) {
            val doc = rows.optJSONObject(i)?.optJSONObject("document") ?: continue
            docs.add(fieldsOf(doc))
        }
        return docs
    }

    private fun intField(doc: JSONObject?, key: String): Int? {
        val raw = doc?.optString(key).orEmpty()
        return raw.toIntOrNull() ?: raw.toDoubleOrNull()?.toInt()
    }

    private fun findCode(propertyId: String): JSONObject? {
        val body = JSONObject()
            .put(
                "structuredQuery",
                JSONObject()
                    .put("from", org.json.JSONArray().put(JSONObject().put("collectionId", "property_codes")))
                    .put(
                        "where",
                        JSONObject().put(
                            "fieldFilter",
                            JSONObject()
                                .put("field", JSONObject().put("fieldPath", "propertyId"))
                                .put("op", "EQUAL")
                                .put("value", JSONObject().put("stringValue", propertyId)),
                        ),
                    )
                    .put("limit", 5),
            )
        val url = endpoint("documents:runQuery")
        val conn = open(url, "POST")
        conn.doOutput = true
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        val text = read(conn)
        val rows = org.json.JSONArray(if (text.trim().startsWith("[")) text else "[$text]")
        for (i in 0 until rows.length()) {
            val doc = rows.optJSONObject(i)?.optJSONObject("document") ?: continue
            return fieldsOf(doc)
        }
        return null
    }

    private fun getDocument(collection: String, id: String): JSONObject? {
        val conn = open(endpoint("documents/$collection/$id"), "GET")
        if (conn.responseCode == 404) return null
        val text = read(conn)
        if (text.isBlank()) return null
        return fieldsOf(JSONObject(text))
    }

    private fun fieldsOf(document: JSONObject): JSONObject {
        val fields = document.optJSONObject("fields") ?: return JSONObject()
        val flat = JSONObject()
        val keys = fields.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = fields.optJSONObject(key) ?: continue
            flat.put(
                key,
                when {
                    value.has("stringValue") -> value.optString("stringValue")
                    value.has("integerValue") -> value.optString("integerValue")
                    value.has("doubleValue") -> value.optDouble("doubleValue")
                    value.has("booleanValue") -> value.optBoolean("booleanValue")
                    else -> value.toString()
                },
            )
        }
        return flat
    }

    private fun endpoint(path: String): String {
        return "https://firestore.googleapis.com/v1/projects/${BuildConfig.FIREBASE_PROJECT_ID}/databases/(default)/$path?key=${BuildConfig.FIREBASE_API_KEY}"
    }

    private fun open(url: String, method: String): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.setRequestProperty("Content-Type", "application/json")
        conn.connectTimeout = 12000
        conn.readTimeout = 12000
        return conn
    }

    private fun read(conn: HttpURLConnection): String {
        val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (conn.responseCode == 403 || text.contains("PERMISSION_DENIED")) {
            throw IllegalStateException("Firebase refused the property read. Deploy the updated Firestore rules.")
        }
        if (conn.responseCode !in 200..299 && conn.responseCode != 404) {
            throw IllegalStateException("Firebase request failed (${conn.responseCode}).")
        }
        return text
    }
}
