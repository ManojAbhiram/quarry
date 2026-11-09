"""
Infrastructure Detection Service - Phase 2
Detects cloud providers, email services, and infrastructure patterns via DNS and certificates.
"""

import logging
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
# from wapalyzer import Wappalyzer, WebPage


# async def detect_with_wappalyzer(url: str):
#     webpage = WebPage.new_from_url(url)
#     wapp = Wappalyzer.latest()
#     return wapp.analyze(webpage)
    
logger = logging.getLogger(__name__)

try:
    import dns.resolver
    import dns.rdatatype
    DNS_AVAILABLE = True
except ImportError:
    DNS_AVAILABLE = False
    logger.warning("dnspython not installed. DNS reconnaissance disabled.")

try:
    import ssl
    import socket
    SSL_AVAILABLE = True
except ImportError:
    SSL_AVAILABLE = False
    logger.warning("SSL/Socket libraries not available")


@dataclass
class DNSRecords:
    """DNS record information"""
    mx_records: List[str]
    txt_records: List[str]
    ns_records: List[str]
    cname_records: Dict[str, List[str]]
    spf_records: List[str]
    dkim_records: List[str]


# ── DNS Service Detection Patterns ─────────────────────────────────────────────

DNS_SERVICE_PATTERNS = {
    # Email Services
    "SendGrid": {
        "mx": ["sendgrid.net"],
        "txt": ["v=spf1 include:sendgrid.net"],
        "category": "Email",
    },
    "Mailgun": {
        "mx": ["mailgun.org"],
        "txt": ["mailgun.org"],
        "category": "Email",
    },
    "AWS SES": {
        "txt": ["v=spf1 include:amazonses.com"],
        "category": "Email",
    },
    "Postmark": {
        "mx": ["postmarkapp.com"],
        "txt": ["postmark"],
        "category": "Email",
    },
    "Mandrill": {
        "txt": ["mandrill"],
        "category": "Email",
    },
    # Cloud Providers
    "AWS": {
        "txt": ["amazonses.com", "amazon.com"],
        "mx": ["amazon.com"],
        "category": "Cloud Provider",
    },
    "Google Cloud": {
        "txt": ["google"],
        "mx": ["google.com"],
        "category": "Cloud Provider",
    },
    "Microsoft Azure": {
        "txt": ["microsoft.com", "azure.com"],
        "category": "Cloud Provider",
    },
    # DNS Providers
    "Route53": {
        "ns": ["awsdns"],
        "category": "DNS",
    },
    "Cloudflare": {
        "ns": ["cloudflare.com"],
        "category": "DNS/CDN",
    },
    "Akamai": {
        "ns": ["akamai.net"],
        "category": "CDN",
    },
    "NS1": {
        "ns": ["ns1.com"],
        "category": "DNS",
    },
    # Authentication & Verification
    "Google Site Verification": {
        "txt": ["google-site-verification"],
        "category": "Authentication",
    },
    "Microsoft Domain Verification": {
        "txt": ["ms=ms"],
        "category": "Authentication",
    },
    "Stripe Verification": {
        "txt": ["stripe-verification"],
        "category": "Payment",
    },
    "GitHub Verification": {
        "txt": ["github"],
        "category": "Version Control",
    },
}

# SSL Certificate Issuer Patterns
SSL_ISSUER_HINTS = {
    "Let's Encrypt": {
        "hint": "OSS/cost-conscious infrastructure",
        "likely_providers": ["AWS", "GCP", "DigitalOcean", "Heroku"],
    },
    "Amazon": {
        "hint": "AWS hosted infrastructure",
        "likely_providers": ["AWS"],
    },
    "Google": {
        "hint": "Google Cloud hosted infrastructure",
        "likely_providers": ["Google Cloud"],
    },
    "Microsoft": {
        "hint": "Azure hosted infrastructure",
        "likely_providers": ["Microsoft Azure"],
    },
    "DigiCert": {
        "hint": "Enterprise infrastructure",
        "likely_providers": ["AWS", "Azure", "GCP"],
    },
    "Sectigo": {
        "hint": "Enterprise infrastructure",
        "likely_providers": ["AWS", "Azure", "GCP"],
    },
}


class DNSReconnaissanceService:
    """DNS-based infrastructure reconnaissance"""

    @staticmethod
    async def scan_dns_records(domain: str) -> DNSRecords:
        """
        Scan DNS records for infrastructure hints.
        
        Args:
            domain: Domain name to scan
            
        Returns:
            DNSRecords object with all DNS information
        """
        if not DNS_AVAILABLE:
            logger.warning("DNS scanning not available (dnspython not installed)")
            return DNSRecords(
                mx_records=[],
                txt_records=[],
                ns_records=[],
                cname_records={},
                spf_records=[],
                dkim_records=[],
            )

        mx_records = []
        txt_records = []
        ns_records = []
        spf_records = []
        dkim_records = []

        try:
            # MX Records
            try:
                mx_records_obj = dns.resolver.resolve(domain, "MX")
                mx_records = [str(mx.exchange).rstrip(".") for mx in mx_records_obj]
                logger.debug(f"MX records for {domain}: {mx_records}")
            except Exception as e:
                logger.debug(f"Failed to get MX records for {domain}: {e}")

            # TXT Records (includes SPF, DKIM, DMARC)
            try:
                txt_records_obj = dns.resolver.resolve(domain, "TXT")
                for txt in txt_records_obj:
                    txt_str = str(txt).strip('"')
                    txt_records.append(txt_str)

                    # Parse SPF records
                    if txt_str.startswith("v=spf1"):
                        spf_records.append(txt_str)

                    # Parse DKIM records
                    if "v=DKIM1" in txt_str:
                        dkim_records.append(txt_str)

                logger.debug(f"TXT records for {domain}: {len(txt_records)} records")
            except Exception as e:
                logger.debug(f"Failed to get TXT records for {domain}: {e}")

            # NS Records
            try:
                ns_records_obj = dns.resolver.resolve(domain, "NS")
                ns_records = [str(ns).rstrip(".") for ns in ns_records_obj]
                logger.debug(f"NS records for {domain}: {ns_records}")
            except Exception as e:
                logger.debug(f"Failed to get NS records for {domain}: {e}")

        except Exception as e:
            logger.error(f"DNS reconnaissance failed for {domain}: {e}")

        return DNSRecords(
            mx_records=mx_records,
            txt_records=txt_records,
            ns_records=ns_records,
            cname_records={},
            spf_records=spf_records,
            dkim_records=dkim_records,
        )

    @staticmethod
    def analyze_dns_records(dns_records: DNSRecords) -> Dict[str, List[str]]:
        """
        Analyze DNS records for service detections.
        
        Args:
            dns_records: DNSRecords object
            
        Returns:
            Dict mapping service names to their infrastructure category
        """
        detections = {}

        # Combine all DNS data
        all_dns_data = (
            dns_records.mx_records
            + dns_records.txt_records
            + dns_records.ns_records
            + dns_records.spf_records
        )
        all_dns_lower = " ".join(all_dns_data).lower()

        # Check against patterns
        for service_name, patterns in DNS_SERVICE_PATTERNS.items():
            detected = False

            # Check MX records
            if "mx" in patterns:
                for pattern in patterns["mx"]:
                    if any(pattern.lower() in mx.lower() for mx in dns_records.mx_records):
                        detected = True
                        break

            # Check TXT records
            if not detected and "txt" in patterns:
                for pattern in patterns["txt"]:
                    if pattern.lower() in all_dns_lower:
                        detected = True
                        break

            # Check NS records
            if not detected and "ns" in patterns:
                for pattern in patterns["ns"]:
                    if any(pattern.lower() in ns.lower() for ns in dns_records.ns_records):
                        detected = True
                        break

            if detected:
                detections[service_name] = patterns.get("category", "Infrastructure")
                logger.info(f"Detected {service_name} via DNS for")

        return detections


class CertificateAnalyzer:
    """SSL/TLS certificate analysis for infrastructure hints"""

    @staticmethod
    async def get_certificate_info(domain: str, timeout: int = 5) -> Optional[Dict]:
        """
        Retrieve SSL certificate information.
        
        Args:
            domain: Domain name
            timeout: Connection timeout in seconds
            
        Returns:
            Dict with certificate information
        """
        if not SSL_AVAILABLE:
            logger.warning("SSL certificate analysis not available")
            return None

        try:
            # Remove protocol if present
            domain_clean = domain.replace("https://", "").replace("http://", "").split("/")[0]

            context = ssl.create_default_context()
            with socket.create_connection((domain_clean, 443), timeout=timeout) as sock:
                with context.wrap_socket(sock, server_hostname=domain_clean) as ssock:
                    cert = ssock.getpeercert()

                    if not cert:
                        return None

                    return {
                        "subject": dict(x[0] for x in cert.get("subject", [])),
                        "issuer": dict(x[0] for x in cert.get("issuer", [])),
                        "version": cert.get("version"),
                        "serial_number": cert.get("serialNumber"),
                        "not_before": cert.get("notBefore"),
                        "not_after": cert.get("notAfter"),
                        "subjectAltName": cert.get("subjectAltName", []),
                    }

        except Exception as e:
            logger.debug(f"Failed to get certificate for {domain}: {e}")
            return None

    @staticmethod
    def analyze_certificate(cert_info: Dict) -> Dict[str, any]:
        """
        Analyze certificate for infrastructure hints.
        
        Args:
            cert_info: Certificate information dict
            
        Returns:
            Dict with infrastructure hints
        """
        hints = {
            "issuer": None,
            "organization": None,
            "san_count": 0,
            "san_patterns": [],
            "infrastructure_hints": [],
        }

        if not cert_info:
            return hints

        # Extract issuer
        issuer_dict = cert_info.get("issuer", {})
        issuer_cn = issuer_dict.get("commonName", "Unknown")
        hints["issuer"] = issuer_cn

        # Extract organization
        subject_dict = cert_info.get("subject", {})
        org = subject_dict.get("organizationName")
        hints["organization"] = org

        # Analyze SANs (Subject Alt Names) for infrastructure patterns
        sans = cert_info.get("subjectAltName", [])
        hints["san_count"] = len(sans)

        san_strings = [str(san[1]) for san in sans if isinstance(san, tuple)]
        hints["san_patterns"] = san_strings

        # Detect multi-region patterns
        if any("us-east" in san.lower() for san in san_strings):
            hints["infrastructure_hints"].append("Multi-region deployment detected (AWS)")

        if any("eu-west" in san.lower() for san in san_strings):
            hints["infrastructure_hints"].append("EU region deployment detected")

        # Detect Kubernetes cluster patterns
        if any("-pod-" in san or "-svc-" in san for san in san_strings):
            hints["infrastructure_hints"].append("Kubernetes cluster detected")

        # Issuer analysis
        for issuer_name, issuer_info in SSL_ISSUER_HINTS.items():
            if issuer_name.lower() in issuer_cn.lower():
                hints["infrastructure_hints"].append(issuer_info["hint"])
                break

        return hints


async def detect_infrastructure_via_dns(domain: str) -> Dict:
    """
    Comprehensive infrastructure detection via DNS and certificates.
    
    Args:
        domain: Domain name to analyze
        
    Returns:
        Dict with infrastructure information
    """
    # Clean domain
    domain_clean = domain.replace("https://", "").replace("http://", "").split("/")[0]

    result = {
        "domain": domain_clean,
        "dns_records": {},
        "detected_services": {},
        "certificate_info": {},
        "infrastructure_hints": [],
    }

    try:
        # DNS scanning
        dns_service = DNSReconnaissanceService()
        dns_records = await dns_service.scan_dns_records(domain_clean)
        result["dns_records"] = asdict(dns_records)

        # Analyze DNS for service detection
        services = dns_service.analyze_dns_records(dns_records)
        result["detected_services"] = services

        # Certificate analysis
        cert_analyzer = CertificateAnalyzer()
        cert_info = await cert_analyzer.get_certificate_info(domain_clean)
        if cert_info:
            result["certificate_info"] = cert_info
            cert_hints = cert_analyzer.analyze_certificate(cert_info)
            result["infrastructure_hints"] = cert_hints.get("infrastructure_hints", [])

    except Exception as e:
        logger.error(f"Infrastructure detection failed for {domain}: {e}")

    return result
