import 'dart:convert';
import 'dart:io';

typedef JsonMap = Map<String, Object?>;

class ApiFailure implements Exception {
  ApiFailure(this.status, this.body);
  final int status;
  final JsonMap body;

  String? get type {
    final value = body['type'];
    return value is String ? value : null;
  }
}

class ProjectSnapshot {
  ProjectSnapshot({
    required this.id,
    required this.revision,
    required this.brief,
    required this.scenes,
  });

  factory ProjectSnapshot.fromJson(JsonMap json) => ProjectSnapshot(
    id: json['id']! as String,
    revision: json['revision']! as int,
    brief: Map<String, Object?>.from(json['brief']! as Map),
    scenes: (json['scenes']! as List)
        .map((value) => Map<String, Object?>.from(value as Map))
        .toList(),
  );

  final String id;
  final int revision;
  final JsonMap brief;
  final List<JsonMap> scenes;
}

class CreatedProject {
  CreatedProject(this.project, this.concepts);
  final ProjectSnapshot project;
  final List<JsonMap> concepts;
}

class ProjectSummary {
  ProjectSummary({
    required this.id,
    required this.revision,
    required this.purpose,
  });

  factory ProjectSummary.fromJson(JsonMap json) {
    final brief = Map<String, Object?>.from(json['brief']! as Map);
    return ProjectSummary(
      id: json['id']! as String,
      revision: json['revision']! as int,
      purpose: (brief['purpose'] as String?)?.trim() ?? '',
    );
  }

  final String id;
  final int revision;
  final String purpose;
}

class RenderJob {
  RenderJob(this.id, this.state);
  final String id;
  final String state;
}

class RenderEvent {
  RenderEvent(this.id, this.phase, this.percent);
  final String id;
  final String phase;
  final int percent;
}

abstract interface class ApiGateway {
  Future<bool> isReachable();
  Future<List<ProjectSummary>> listProjects();
  Future<CreatedProject> createProject(String brief);
  Future<ProjectSnapshot> command(
    String projectId,
    int revision,
    String kind,
    JsonMap payload,
  );
  Future<List<JsonMap>> searchPexels(String query);
  Future<void> copyPexels(String projectId, String query, int id);
  Future<RenderJob> render(String projectId);
  Future<List<RenderEvent>> events(String jobId, String? lastEventId);
  Future<void> cancel(String jobId);
  Future<Uri> download(String jobId);
}

class HttpApiGateway implements ApiGateway {
  HttpApiGateway({
    required this.baseUri,
    required this.accessToken,
    HttpClient? client,
  }) : _client = client ?? HttpClient();

  final Uri baseUri;
  final Future<String?> Function() accessToken;
  final HttpClient _client;

  @override
  Future<bool> isReachable() async {
    HttpClientRequest? request;
    try {
      request = await _client
          .getUrl(baseUri.resolve('/readyz'))
          .timeout(const Duration(seconds: 2));
      final response = await request.close().timeout(
        const Duration(seconds: 2),
      );
      final status = response.statusCode;
      await response.drain<void>().timeout(const Duration(seconds: 2));
      return status == HttpStatus.ok;
    } catch (_) {
      request?.abort();
      return false;
    }
  }

  Future<(int, String, String?)> _raw(
    String method,
    String path, [
    JsonMap? body,
    Map<String, String> headers = const {},
  ]) async {
    final request = await _client.openUrl(method, baseUri.resolve(path));
    final token = await accessToken();
    if (token == null || token.isEmpty) {
      throw ApiFailure(401, {'message': 'Sign in required'});
    }
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    headers.forEach(request.headers.set);
    if (body != null) {
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
    }
    final response = await request.close();
    final text = await utf8.decoder.bind(response).join();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiFailure(
        response.statusCode,
        text.isEmpty ? {} : Map<String, Object?>.from(jsonDecode(text) as Map),
      );
    }
    return (response.statusCode, text, response.headers.contentType?.mimeType);
  }

  Future<JsonMap> _json(String method, String path, [JsonMap? body]) async {
    final (_, text, _) = await _raw(method, path, body);
    return Map<String, Object?>.from(jsonDecode(text) as Map);
  }

  @override
  Future<List<ProjectSummary>> listProjects() async {
    final json = await _json('GET', '/api/projects');
    return (json['projects']! as List)
        .map((value) => ProjectSummary.fromJson(Map<String, Object?>.from(value as Map)))
        .toList();
  }

  @override
  Future<CreatedProject> createProject(String brief) async {
    final json = await _json('POST', '/api/projects', {
      'purpose': brief,
      'audience': 'Customers',
      'tone': 'Warm',
    });
    return CreatedProject(
      ProjectSnapshot.fromJson(
        Map<String, Object?>.from(json['project']! as Map),
      ),
      (json['concepts']! as List)
          .map((value) => Map<String, Object?>.from(value as Map))
          .toList(),
    );
  }

  @override
  Future<ProjectSnapshot> command(
    String projectId,
    int revision,
    String kind,
    JsonMap payload,
  ) async {
    final json = await _json('POST', '/api/projects/$projectId/commands', {
      'command_id': '${DateTime.now().microsecondsSinceEpoch}-$kind',
      'base_revision': revision,
      'client_timestamp': DateTime.now().toUtc().toIso8601String(),
      'kind': kind,
      'payload': payload,
    });
    return ProjectSnapshot.fromJson(json);
  }

  @override
  Future<List<JsonMap>> searchPexels(String query) async {
    final json = await _json(
      'GET',
      '/api/pexels/search?q=${Uri.encodeQueryComponent(query)}',
    );
    return (json['results']! as List)
        .map((value) => Map<String, Object?>.from(value as Map))
        .toList();
  }

  @override
  Future<void> copyPexels(String projectId, String query, int id) async {
    await _json('POST', '/api/projects/$projectId/media/pexels', {
      'query': query,
      'pexels_id': id,
    });
  }

  @override
  Future<RenderJob> render(String projectId) async {
    final json = await _json('POST', '/api/projects/$projectId/render');
    return RenderJob(json['job_id']! as String, json['state']! as String);
  }

  @override
  Future<List<RenderEvent>> events(String jobId, String? lastEventId) async {
    final (_, text, _) = await _raw(
      'GET',
      '/api/render-jobs/$jobId/events',
      null,
      lastEventId == null ? const {} : {'last-event-id': lastEventId},
    );
    return text
        .split('\n\n')
        .map(
          (block) => RegExp(
            r'^data: (.+)$',
            multiLine: true,
          ).firstMatch(block)?.group(1),
        )
        .whereType<String>()
        .map((value) {
          final json = Map<String, Object?>.from(jsonDecode(value) as Map);
          return RenderEvent(
            json['event_id']! as String,
            json['phase']! as String,
            json['percent']! as int,
          );
        })
        .toList();
  }

  @override
  Future<void> cancel(String jobId) async {
    await _json('POST', '/api/render-jobs/$jobId/cancel');
  }

  @override
  Future<Uri> download(String jobId) async {
    final json = await _json('GET', '/api/render-jobs/$jobId/download');
    return Uri.parse(json['url']! as String);
  }
}
