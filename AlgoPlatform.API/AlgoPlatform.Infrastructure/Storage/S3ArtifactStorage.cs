using Amazon;
using Amazon.S3;
using Amazon.S3.Model;
using AlgoPlatform.Application.Abstractions;
using Microsoft.Extensions.Configuration;
using System.Globalization;
using System.Reflection;

namespace AlgoPlatform.Infrastructure.Storage
{
    public sealed class S3ArtifactStorage : IArtifactStorage
    {
        private readonly IAmazonS3 _s3;
        private readonly string _bucket;

        public S3ArtifactStorage(IAmazonS3 s3, IConfiguration configuration)
        {
            _s3 = s3;
            _bucket = configuration["S3:Bucket"] ?? throw new InvalidOperationException("S3:Bucket is not configured");
        }

        public async Task UploadAsync(string key, Stream content, string contentType, CancellationToken ct)
        {
            var req = new PutObjectRequest
            {
                BucketName = _bucket,
                Key = key,
                InputStream = content,
                ContentType = contentType
            };

            await _s3.PutObjectAsync(req, ct);
        }

        public async Task<Stream> DownloadAsync(string key, CancellationToken ct)
        {
            using var resp = await _s3.GetObjectAsync(_bucket, key, ct);
            var ms = new MemoryStream();
            await resp.ResponseStream.CopyToAsync(ms, ct);
            ms.Position = 0;
            return ms;
        }

        public async Task<bool> ExistsAsync(string key, CancellationToken ct)
        {
            try
            {
                await _s3.GetObjectMetadataAsync(_bucket, key, ct);
                return true;
            }
            catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return false;
            }
        }

        public static IAmazonS3 BuildClient(IConfiguration configuration)
        {
            var endpoint = configuration["S3:Endpoint"];
            var region = configuration["S3:Region"];
            var accessKey = GetConfigOrEnv(configuration, "S3:AccessKey", "AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY");
            var secretKey = GetConfigOrEnv(configuration, "S3:SecretKey", "AWS_SECRET_ACCESS_KEY", "AWS_SECRET_KEY");
            var usePathStyle = configuration.GetValue<bool?>("S3:UsePathStyle") ?? false;
            var useSigV4 = configuration.GetValue<bool?>("S3:UseSignatureVersion4") ?? true;

            if (string.IsNullOrWhiteSpace(endpoint))
            {
                throw new InvalidOperationException("S3:Endpoint is not configured");
            }

            if (string.IsNullOrWhiteSpace(accessKey) || string.IsNullOrWhiteSpace(secretKey))
            {
                throw new InvalidOperationException("S3 credentials are not configured (S3:AccessKey/S3:SecretKey or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY).");
            }

            TrySetAwsConfigs("UseSignatureVersion4", useSigV4);

            var isCustomEndpoint = !endpoint.Contains("amazonaws.com", StringComparison.OrdinalIgnoreCase);
            var cfg = new AmazonS3Config
            {
                ServiceURL = endpoint,
                ForcePathStyle = usePathStyle
            };

            if (!isCustomEndpoint)
            {
                cfg.RegionEndpoint = !string.IsNullOrWhiteSpace(region)
                    ? RegionEndpoint.GetBySystemName(region)
                    : RegionEndpoint.USEast1;
            }

            ApplyS3CompatTweaks(cfg, endpoint, region, useSigV4);

            return new AmazonS3Client(accessKey, secretKey, cfg);
        }

        private static void ApplyS3CompatTweaks(AmazonS3Config cfg, string endpoint, string? region, bool useSigV4)
        {
            var regionName = string.IsNullOrWhiteSpace(region) ? "us-east-1" : region;

            TrySetConfig(cfg, "UseHttp", endpoint.StartsWith("http://", StringComparison.OrdinalIgnoreCase));
            if (useSigV4)
            {
                TrySetConfig(cfg, "SignatureVersion", "4");
                TrySetConfig(cfg, "SignatureMethod", "HmacSHA256");
            }

            TrySetConfig(cfg, "AuthenticationRegion", regionName);
            TrySetConfig(cfg, "DisablePayloadSigning", true);
            TrySetConfig(cfg, "UseChunkEncoding", false);
        }

        private static void TrySetAwsConfigs(string propertyName, bool value)
        {
            try
            {
                var type = Type.GetType("Amazon.S3.AWSConfigsS3, AWSSDK.S3");
                var prop = type?.GetProperty(propertyName, BindingFlags.Public | BindingFlags.Static);
                if (prop?.CanWrite == true && prop.PropertyType == typeof(bool))
                {
                    prop.SetValue(null, value);
                }
            }
            catch
            {
                // Best-effort: ignore if API is unavailable in current AWSSDK version.
            }
        }

        private static void TrySetConfig(AmazonS3Config cfg, string propertyName, object? value)
        {
            if (value is null) return;

            try
            {
                var prop = cfg.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
                if (prop?.CanWrite != true) return;

                object? converted = value;
                if (value is not null && !prop.PropertyType.IsInstanceOfType(value))
                {
                    if (prop.PropertyType.IsEnum)
                    {
                        converted = value is string s
                            ? Enum.Parse(prop.PropertyType, s, ignoreCase: true)
                            : Enum.ToObject(prop.PropertyType, value);
                    }
                    else
                    {
                        converted = Convert.ChangeType(value, prop.PropertyType, CultureInfo.InvariantCulture);
                    }
                }

                prop.SetValue(cfg, converted);
            }
            catch
            {
                // Best-effort: ignore if API is unavailable in current AWSSDK version.
            }
        }

        private static string? GetConfigOrEnv(IConfiguration configuration, string configKey, string envKey, string? fallbackEnvKey = null)
        {
            var val = configuration[configKey];
            if (!string.IsNullOrWhiteSpace(val)) return val;

            val = Environment.GetEnvironmentVariable(envKey);
            if (!string.IsNullOrWhiteSpace(val)) return val;

            return string.IsNullOrWhiteSpace(fallbackEnvKey)
                ? null
                : Environment.GetEnvironmentVariable(fallbackEnvKey);
        }
    }
}
