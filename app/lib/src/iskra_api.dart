import 'dart:convert';
import 'dart:io';
import 'dart:math';

class IskraApiException implements Exception {
  const IskraApiException(this.code);

  final String code;
}

class IskraApi {
  const IskraApi(this.baseUrl);

  final Uri baseUrl;

  HttpClient _client() =>
      HttpClient()..connectionTimeout = const Duration(seconds: 5);

  Future<bool> ready() async {
    final client = _client();
    try {
      final request = await client.getUrl(baseUrl.resolve('/health/ready'));
      request.followRedirects = false;
      final response = await request.close().timeout(
        const Duration(seconds: 5),
      );
      return response.statusCode == HttpStatus.ok;
    } on Exception {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  Stream<String> streamChat({
    required String token,
    required String text,
  }) async* {
    final client = _client();
    try {
      final request = await client.postUrl(baseUrl.resolve('/v1/chat/stream'));
      request.followRedirects = false;
      request.headers.contentType = ContentType.json;
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.set(HttpHeaders.acceptHeader, 'text/event-stream');
      request.write(jsonEncode({'requestId': _requestId(), 'text': text}));
      final response = await request.close().timeout(
        const Duration(seconds: 15),
      );
      if (response.statusCode != HttpStatus.ok) {
        final body = await response
            .transform(utf8.decoder)
            .join()
            .timeout(const Duration(seconds: 5));
        throw IskraApiException(
          _errorCode(body, 'http_${response.statusCode}'),
        );
      }
      if (response.headers.contentType?.mimeType != 'text/event-stream') {
        throw const IskraApiException('invalid_stream');
      }

      var event = '';
      final data = <String>[];
      final lines = response
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .timeout(const Duration(seconds: 95));
      await for (final line in lines) {
        if (line.startsWith('event:')) event = line.substring(6).trim();
        if (line.startsWith('data:')) data.add(line.substring(5).trimLeft());
        if (line.isNotEmpty) continue;
        if (data.isNotEmpty) {
          final payload = data.join('\n');
          if (event == 'error') {
            throw IskraApiException(_errorCode(payload, 'stream_error'));
          }
          if (payload == '[DONE]') return;
          final chunk = jsonDecode(payload);
          if (chunk case {
            'choices': [{'delta': {'content': final String text}}, ...],
          }) {
            if (text.isNotEmpty) yield text;
          }
        }
        event = '';
        data.clear();
      }
      throw const IskraApiException('stream_interrupted');
    } finally {
      client.close(force: true);
    }
  }

  String _errorCode(String payload, String fallback) {
    try {
      final body = jsonDecode(payload);
      if (body case {'error': {'code': final String code}}) return code;
      if (body case {'code': final String code}) return code;
    } on FormatException {
      return fallback;
    }
    return fallback;
  }

  String _requestId() {
    final random = Random.secure();
    final bytes = List.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
        '${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
